/** Tente d'autres endpoints pour ORDELION. */
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

// SQLQuery a SqlCode comme PK. Listons un par un.
console.log("=== 1 SQLQueries TOP 5 sans filtre ===");
const r0 = await req("GET", "SQLQueries?$top=5", { cookies });
console.log("Status:", r0.status, "value.len:", r0.body?.value?.length, "raw start:", JSON.stringify(r0.body).slice(0, 400));

console.log("\n=== 1.b SQLQueries(SQ_001) direct ===");
const r0b = await req("GET", "SQLQueries('Sys_ORDELION')", { cookies });
console.log("Status:", r0b.status, JSON.stringify(r0b.body).slice(0, 400));

console.log("\n=== 2 Liste 100 SQLQueries (cherche ORDELION/gervi) ===");
let skip = 0;
let found = [];
while (skip < 600) {
  const r = await req("GET", `SQLQueries?$top=100&$skip=${skip}`, { cookies });
  const items = r.body?.value || [];
  if (items.length === 0) break;
  for (const q of items) {
    const text = JSON.stringify(q);
    if (/ORDELION|gervi|TPF|ITFL|DDG|ITFEL|INTERFEL/i.test(text)) {
      found.push(q);
    }
  }
  skip += items.length;
}
console.log(`Total trouvés: ${found.length}`);
for (const q of found) {
  console.log(`\n--- SqlCode=${q.SqlCode} SqlName=${q.SqlName || q.QueryDescription || q.IntrnalKey} ---`);
  console.log("Text:", (q.SqlText || "").slice(0, 2500));
}

// 3. UserObjectsMD pour add-on Gervifrais ?
console.log("\n=== 3 UserObjectsMD (filter gervi) ===");
const uo = await req("GET", "UserObjectsMD?$top=200", { cookies });
const matches = (uo.body?.value || []).filter(o => /ORDELION|gervi|TPF|ITFL|DDG|ITFEL/i.test(JSON.stringify(o)));
console.log(`Total ${uo.body?.value?.length || 0} UO, ${matches.length} match :`);
for (const o of matches) console.log(`  Code=${o.Code} Name=${o.Name}`);

// 4. FormattedSearches / FieldsSpecification
for (const ep of ["FormattedSearches", "BusinessRules", "ApprovalTemplates"]) {
  const r = await req("GET", `${ep}?$top=5`, { cookies });
  console.log(`\n=== ${ep} → ${r.status} ===`);
  if (r.status === 200 && r.body?.value?.[0]) {
    console.log("Keys:", Object.keys(r.body.value[0]).slice(0, 15).join(", "));
  }
}

await req("POST", "Logout", { cookies });
