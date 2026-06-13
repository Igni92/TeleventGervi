/** Trouve les coefficients par (groupe client × groupe article) : CustomerGroups + UDT. */
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
if (login.status !== 200) { console.log("LOGIN", login.status, JSON.stringify(login.body).slice(0,150)); process.exit(0); }

// 1. CustomerGroups (Administration > Groupes de clients)
console.log("=== CustomerGroups ===");
const cg = await req("GET", "CustomerGroups?$top=5", { cookies });
console.log("status", cg.status);
if (cg.body?.value?.[0]) {
  console.log("Keys:", Object.keys(cg.body.value[0]).join(", "));
  cg.body.value.slice(0,5).forEach(g => console.log(`  ${JSON.stringify(g).slice(0,200)}`));
}

// 2. UDTs candidates (coef / pv / prix)
console.log("\n=== UDT contenant coef/pv/prix/groupe ===");
let skip = 0; const tables = [];
while (skip < 400) {
  const r = await req("GET", `UserTablesMD?$top=100&$skip=${skip}&$select=TableName,TableDescription`, { cookies });
  const its = r.body?.value || []; if (!its.length) break; tables.push(...its); skip += its.length;
}
for (const t of tables) {
  if (/coef|pv|prix|price|groupe|gr_cli|grp/i.test(t.TableName + " " + t.TableDescription))
    console.log(`  @${t.TableName} — ${t.TableDescription}`);
}

// 3. Inspecte les UDT coef trouvées
for (const t of tables) {
  if (!/coef|pv_|prix|price/i.test(t.TableName + t.TableDescription)) continue;
  const r = await req("GET", `${t.TableName}?$top=3`, { cookies });
  if (r.status === 200 && r.body?.value?.[0]) {
    console.log(`\n  @${t.TableName} keys: ${Object.keys(r.body.value[0]).join(", ")}`);
    r.body.value.slice(0,3).forEach(row => console.log(`    ${JSON.stringify(row).slice(0,250)}`));
  }
}

// 4. Prix d'achat d'un article (LastPurchasePrice ?) — FE1SL
console.log("\n=== Prix achat article FE1SL ===");
const it = await req("GET", "Items('FE1SL')?$select=ItemCode,ItemsGroupCode,LastPurchasePrice,ItemPrices", { cookies });
console.log("status", it.status, JSON.stringify(it.body).slice(0, 300));

await req("POST", "Logout", { cookies });
