/** Annule (Cancel, pas suppression) toutes les commandes de test "SMOKE" / "TEST". */
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
console.log("DB:", process.env.SAP_B1_COMPANY_DB);

// Récupère toutes les commandes ouvertes dont le commentaire commence par SMOKE/TEST
let toCancel = [];
let skip = 0;
while (skip < 600) {
  const r = await req("GET", `Orders?$top=100&$skip=${skip}&$orderby=DocEntry desc&$select=DocEntry,DocNum,Comments,DocumentStatus,Cancelled`, { cookies });
  const docs = r.body?.value || [];
  if (!docs.length) break;
  for (const o of docs) {
    if (o.Cancelled === "tYES" || o.DocumentStatus === "bost_Close") continue;
    if (/^(SMOKE|TEST)/i.test(o.Comments || "")) toCancel.push(o);
  }
  skip += docs.length;
}
console.log(`À annuler : ${toCancel.length} commandes de test ouvertes`);

let ok = 0, fail = 0;
for (const o of toCancel) {
  const c = await req("POST", `Orders(${o.DocEntry})/Cancel`, { cookies });
  if (c.status >= 200 && c.status < 300) { ok++; }
  else { fail++; console.log(`  ❌ #${o.DocNum} (${o.DocEntry}) → ${c.status} ${JSON.stringify(c.body).slice(0,120)}`); }
}
console.log(`\n✅ Annulées : ${ok}   ❌ Échecs : ${fail}`);
await req("POST", "Logout", { cookies });
