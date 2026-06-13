/** Déduit groupe_article → catégorie en croisant Coef de la vue avec les U_MB_<cat> des groupes clients. */
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
if (login.status !== 200) { console.log("LOGIN FAIL", login.status); process.exit(0); }

const CATS = ["Fruits_Rges","Fraises","Legumes","Fruits_Prep","Divers_Fruits","Fruits_Secs","Autres"];
// 1. U_MB_<cat> de plusieurs groupes clients
const grpCoefs = {}; // code -> {cat: coef}
for (const code of [113,115,116,117,118,138,120]) {
  const g = await req("GET", `BusinessPartnerGroups(${code})`, { cookies });
  if (g.status !== 200) continue;
  const map = {};
  for (const c of CATS) { const v = g.body[`U_MB_${c}`]; if (v != null && v !== 0) map[c] = v; }
  grpCoefs[code] = { name: g.body.Name, map };
}
console.log("Coefs par groupe client:");
for (const [code, g] of Object.entries(grpCoefs)) console.log(`  ${code} ${g.name}: ${JSON.stringify(g.map)}`);

// 2. Scan vue : par (Groupe_Article, Code Groupe Client) → Coef. On garde un Coef par couple.
const viewCoef = {}; // grpArt -> {clientGroup: coef}
const grpArtName = {};
let skip = 0;
while (skip < 30000) {
  const r = await req("GET", `view.svc/GERVI_SITE_PVB1SLQuery?$top=500&$skip=${skip}`, { cookies });
  const rows = r.body?.value || []; if (!rows.length) break;
  for (const row of rows) {
    const ga = row.Groupe_Article, cg = row["Code Groupe Client"], coef = row.Coef;
    if (ga == null) continue;
    (viewCoef[ga] ||= {})[cg] = coef;
  }
  skip += rows.length;
}
console.log(`\nGroupes article vus dans la vue: ${Object.keys(viewCoef).length}`);

// 3. Pour chaque groupe article, match le Coef d'un groupe client à sa catégorie
console.log("\n=== Mapping déduit groupe_article → catégorie ===");
const eps = 0.001;
for (const ga of Object.keys(viewCoef).sort((a,b)=>a-b)) {
  let found = null;
  for (const [code, g] of Object.entries(grpCoefs)) {
    const coef = viewCoef[ga][code];
    if (coef == null) continue;
    for (const [cat, val] of Object.entries(g.map)) {
      if (Math.abs(val - coef) < eps) { found = cat; break; }
    }
    if (found) break;
  }
  console.log(`  groupe ${ga} → ${found ?? "??? (coefs: " + JSON.stringify(viewCoef[ga]) + ")"}`);
}
await req("POST", "Logout", { cookies });
