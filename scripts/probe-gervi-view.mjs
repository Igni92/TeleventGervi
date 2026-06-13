/** Comprendre GERVI_SITE_PVB1SLQuery : mapping groupe client, filtrage, prix par item. */
import https from "node:https"; import fs from "node:fs"; import { URL } from "node:url";
function loadEnv(p) {
  if (!fs.existsSync(p)) return;
  for (const line of fs.readFileSync(p, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (m && !process.env[m[1]]) { let v = m[2].trim();
      if ((v.startsWith('"') && v.endsWith('"'))) v = v.slice(1, -1);
      v = v.replace(/\\\$/g, "$"); process.env[m[1]] = v; }
  }
}
loadEnv(".env.local");
function req(method, path, opts = {}) {
  return new Promise((res, rej) => {
    const t = new URL(path, process.env.SAP_B1_BASE_URL + "/");
    const r = https.request({ hostname: t.hostname, port: t.port || 443, path: t.pathname + t.search, method,
      rejectUnauthorized: false, headers: { "Content-Type": "application/json", ...(opts.cookies ? { Cookie: opts.cookies } : {}) } },
      (resp) => { let d = ""; resp.on("data", c => d += c); resp.on("end", () => { let p = d; try { p = JSON.parse(d); } catch {}; res({ status: resp.statusCode, body: p, headers: resp.headers }); }); });
    r.on("error", rej); if (opts.body) r.write(JSON.stringify(opts.body)); r.end();
  });
}
const login = await req("POST", "Login", { body: { CompanyDB: process.env.SAP_B1_COMPANY_DB, UserName: process.env.SAP_B1_USERNAME, Password: process.env.SAP_B1_PASSWORD } });
const cookies = (login.headers["set-cookie"] || []).map(c => c.split(";")[0]).join("; ");

// 1. Toutes les colonnes
const head = await req("GET", "view.svc/GERVI_SITE_PVB1SLQuery?$top=1", { cookies });
console.log("Colonnes:", Object.keys(head.body?.value?.[0] || {}).join(" | "));

// 2. Combien de lignes au total ? Distinct groupes client ?
let skip = 0; const groups = new Map(); const byItem = new Map(); let total = 0;
while (skip < 20000) {
  const r = await req("GET", `view.svc/GERVI_SITE_PVB1SLQuery?$top=500&$skip=${skip}`, { cookies });
  const rows = r.body?.value || []; if (!rows.length) break;
  for (const row of rows) {
    total++;
    const gc = row["Code Groupe Client"]; const gl = row["Libellé Groupe Client"];
    if (!groups.has(gc)) groups.set(gc, gl);
    const it = row.ItemCode;
    if (!byItem.has(it)) byItem.set(it, []);
    byItem.get(it).push({ gc, pv: row["Prix vente"], pvht: row.PV_HT, cal: row.Calibre, classe: row.Classe, arome: row.Arome });
  }
  skip += rows.length;
  if (skip >= 3000) break; // échantillon suffisant
}
console.log(`\nLignes échantillon: ${total}`);
console.log(`Groupes client distincts (${groups.size}):`);
for (const [gc, gl] of [...groups].slice(0, 30)) console.log(`  ${gc} → ${gl}`);

// 3. Prix d'un item across groupes
const sampleItem = [...byItem.keys()].find(k => byItem.get(k).length > 1) || [...byItem.keys()][0];
console.log(`\nItem ${sampleItem} — prix par groupe:`);
for (const r of byItem.get(sampleItem).slice(0, 10)) console.log(`  groupe ${r.gc}: PV=${r.pv} PV_HT=${r.pvht} calibre=${r.cal} classe=${r.classe} arome=${r.arome}`);

// 4. Filtrage OData possible sur ItemCode ?
const f = await req("GET", `view.svc/GERVI_SITE_PVB1SLQuery?$filter=ItemCode eq '${sampleItem}'&$top=5`, { cookies });
console.log(`\nFiltre ItemCode eq '${sampleItem}' → status ${f.status}, lignes ${f.body?.value?.length ?? "?"}`);

// 5. Groupe du client AAUXERRE (BP) vs view
const bp = await req("GET", "BusinessPartners('AAUXERRE')?$select=CardCode,GroupCode", { cookies });
console.log(`\nBP AAUXERRE GroupCode = ${bp.body?.GroupCode}`);
console.log(`Ce GroupCode est-il dans les 'Code Groupe Client' de la vue ? ${groups.has(bp.body?.GroupCode) ? "OUI" : "NON — mapping différent"}`);

await req("POST", "Logout", { cookies });
