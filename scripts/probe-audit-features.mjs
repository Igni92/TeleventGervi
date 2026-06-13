/** Sonde : GERVI_SITE_PVB1SLQuery (prix), Cancel commande, encours BP, champs variété/calibre. */
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

// ── 1. GERVI_SITE_PVB1SLQuery — requête prix ──
console.log("=== 1. GERVI_SITE_PVB1SLQuery (prix par groupe client) ===");
for (const ep of [
  "SQLQueries('GERVI_SITE_PVB1SLQuery')",
  "SQLQueries('GERVI_SITE_PVB1SLQuery')/List",
  "sml.svc/GERVI_SITE_PVB1SLQuery",
  "view.svc/GERVI_SITE_PVB1SLQuery",
  "GERVI_SITE_PVB1SLQuery",
]) {
  const r = await req("GET", `${ep}${ep.includes("?")?"":"?$top=3"}`, { cookies });
  console.log(`  ${ep} → ${r.status}`);
  if (r.status === 200) {
    const v = r.body?.value || (Array.isArray(r.body) ? r.body : [r.body]);
    if (v[0]) console.log(`    Keys: ${Object.keys(v[0]).join(", ").slice(0,300)}`);
    console.log(`    Sample: ${JSON.stringify(v[0] ?? r.body).slice(0, 400)}`);
  } else if (typeof r.body === "object") console.log(`    ${r.body?.error?.message?.value || JSON.stringify(r.body).slice(0,150)}`);
}

// ── 2. Cancel d'une commande SMOKE ──
console.log("\n=== 2. Annulation (Cancel) d'une commande SMOKE ===");
const sm = await req("GET", "Orders?$top=1&$orderby=DocEntry desc&$filter=" + encodeURIComponent("startswith(Comments,'SMOKE')") , { cookies });
const cand = sm.body?.value?.[0];
if (cand) {
  console.log(`  Cible: #${cand.DocNum} DocEntry=${cand.DocEntry} status=${cand.DocumentStatus} cancelled=${cand.Cancelled}`);
  const c = await req("POST", `Orders(${cand.DocEntry})/Cancel`, { cookies });
  console.log(`  POST Orders(${cand.DocEntry})/Cancel → ${c.status} ${c.status>=400?JSON.stringify(c.body).slice(0,200):"(OK annulée)"}`);
  const after = await req("GET", `Orders(${cand.DocEntry})?$select=DocNum,DocumentStatus,Cancelled`, { cookies });
  console.log(`  Après: status=${after.body?.DocumentStatus} Cancelled=${after.body?.Cancelled}`);
} else console.log("  Aucune commande SMOKE trouvée (filtre startswith).");

// ── 3. Encours / blocage BP ──
console.log("\n=== 3. Encours / blocage client (BusinessPartners) ===");
const bp = await req("GET", "BusinessPartners('AAUXERRE')?$select=CardCode,CardName,CurrentAccountBalance,CreditLimit,Frozen,Valid,BlockDunning,GroupCode", { cookies });
if (bp.status === 200) {
  console.log(`  ${JSON.stringify(bp.body)}`);
}

// ── 4. Champs custom article : variété / calibre / marque ──
console.log("\n=== 4. Champs U_* sur l'article (variété/calibre/marque) ===");
const it = await req("GET", "Items('GRO12C')", { cookies });
if (it.status === 200) {
  const us = Object.entries(it.body).filter(([k,v]) => k.startsWith("U_"));
  for (const [k,v] of us) console.log(`  ${k} = ${JSON.stringify(v)}`);
}

await req("POST", "Logout", { cookies });
