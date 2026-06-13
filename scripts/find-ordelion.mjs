/** Cherche "ORDELION : Calcul gervi supp" dans SAP. */
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

// 1. SAP B1 user queries (FMS)
console.log("=== SQLQueries (substringof 'ORDELION' or 'gervi') ===");
for (const filter of ["substringof('ORDELION',Name)", "substringof('gervi',Name)", "substringof('Calcul',Name)", "substringof('ORDELION',SqlText)", "substringof('gervi',SqlText)"]) {
  const r = await req("GET", `SQLQueries?$filter=${encodeURIComponent(filter)}&$top=10`, { cookies });
  if (r.status === 200) {
    const items = r.body?.value || [];
    if (items.length > 0) {
      console.log(`\n  ${filter} → ${items.length} matches:`);
      for (const q of items) {
        console.log(`    SqlCode=${q.SqlCode} Name=${q.Name}`);
        const txt = (q.SqlText || "").slice(0, 1200);
        console.log(`    SqlText: ${txt}`);
      }
    } else {
      console.log(`  ${filter} → 0`);
    }
  } else {
    console.log(`  ${filter} → ${r.status}: ${r.body?.error?.message?.value || ""}`);
  }
}

// 2. User-defined functions
console.log("\n=== UserDefinedFunctions ===");
const udf = await req("GET", "UserDefinedFunctions?$top=10", { cookies });
console.log("Status:", udf.status, "matches:", udf.body?.value?.length);

// 3. List all SQLQueries (top 50) — look at names
console.log("\n=== Liste de toutes les SQLQueries (top 50) ===");
const all = await req("GET", "SQLQueries?$top=80&$select=SqlCode,Name", { cookies });
for (const q of (all.body?.value || [])) {
  console.log(`  ${(q.SqlCode || "").padEnd(15)} | ${q.Name || ""}`);
}

await req("POST", "Logout", { cookies });
