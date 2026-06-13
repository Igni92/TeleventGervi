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

// 1. Liste toutes les SQLQueries (clé = SqlCode) — pagination
console.log("=== Liste SQLQueries ===");
let skip = 0; const all = [];
while (skip < 1000) {
  const r = await req("GET", `SQLQueries?$skip=${skip}`, { cookies });
  if (r.status !== 200) { console.log("status", r.status, JSON.stringify(r.body).slice(0,150)); break; }
  const v = r.body?.value || []; if (!v.length) break;
  all.push(...v); skip += v.length;
}
console.log("Total:", all.length);
for (const q of all) {
  const name = q.QueryDescription || q.SqlName || q.Name || "";
  if (/gervi|pv|prix|site|pvb1|coef/i.test(name + " " + (q.SqlCode||""))) {
    console.log(`  ★ SqlCode=${q.SqlCode} | ${name}`);
  }
}
// montre les 20 premiers codes pour voir le format
console.log("\nÉchantillon codes:", all.slice(0,20).map(q=>`${q.SqlCode}:${q.QueryDescription||q.SqlName||""}`).join(" | "));

// 2. Essaie d'accéder direct à la requête par variantes de clé
for (const key of ["GERVI_SITE_PVB1SLQuery", "GERVI_SITE_PVB1SL", "SQL_GERVI_SITE_PVB1SLQuery"]) {
  const r = await req("GET", `SQLQueries('${key}')`, { cookies });
  console.log(`\nSQLQueries('${key}') → ${r.status}`);
  if (r.status === 200) {
    console.log("  Keys:", Object.keys(r.body).join(", "));
    console.log("  SQL:", (r.body.SqlText || r.body.Query || "").slice(0, 2000));
  }
}

await req("POST", "Logout", { cookies });
