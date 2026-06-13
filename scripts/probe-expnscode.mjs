/** Cherche une entité SAP appelée "ExpnsCode" ou similaire. */
import https from "node:https";
import fs from "node:fs";
import { URL } from "node:url";
function loadEnv(p) {
  if (!fs.existsSync(p)) return;
  for (const line of fs.readFileSync(p, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (m && !process.env[m[1]]) {
      let v = m[2].trim();
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
      v = v.replace(/\\\$/g, "$"); process.env[m[1]] = v;
    }
  }
}
loadEnv(".env.local");
const BASE = process.env.SAP_B1_BASE_URL;
function req(method, path, opts = {}) {
  return new Promise((res, rej) => {
    const t = new URL(path, BASE + "/");
    const r = https.request({ hostname: t.hostname, port: t.port || 443, path: t.pathname + t.search, method,
      rejectUnauthorized: false, headers: { "Content-Type": "application/json", ...(opts.cookies ? { Cookie: opts.cookies } : {}) } },
      (resp) => { let d = ""; resp.on("data", c => d += c); resp.on("end", () => { let p = d; try { p = JSON.parse(d); } catch {}; res({ status: resp.statusCode, headers: resp.headers, body: p }); }); });
    r.on("error", rej); if (opts.body) r.write(JSON.stringify(opts.body)); r.end();
  });
}
const login = await req("POST", "Login", { body: { CompanyDB: process.env.SAP_B1_COMPANY_DB, UserName: process.env.SAP_B1_USERNAME, Password: process.env.SAP_B1_PASSWORD } });
const cookies = (login.headers["set-cookie"] || []).map(c => c.split(";")[0]).join("; ");

// Test endpoints likely related
const endpoints = [
  "ExpnsCode", "ExpnsCodes", "ExpenseCode", "ExpenseCodes",
  "Expenses", "ExpensesDefinition", "ExpensesDefinitions",
  "AdditionalExpenseCodes", "AdditionalExpense",
  "U_ExpnsCode", "UDT_ExpnsCode",
  // Possibly UserDefinedFields
  "$metadata",
];

for (const ep of endpoints) {
  const r = await req("GET", `${ep}?$top=3`, { cookies });
  console.log(`\n== ${ep} → ${r.status} ==`);
  if (r.status === 200) {
    if (ep === "$metadata") {
      // find lines mentioning expns
      const txt = typeof r.body === "string" ? r.body : JSON.stringify(r.body);
      const m = txt.match(/Expns[^<>"\s]+/gi) || [];
      console.log("Matches in metadata:", [...new Set(m)].slice(0, 30));
    } else {
      const items = r.body?.value || (Array.isArray(r.body) ? r.body : [r.body]);
      if (items.length > 0 && typeof items[0] === "object") {
        console.log("Keys:", Object.keys(items[0]).slice(0, 20).join(", "));
        items.slice(0, 2).forEach(it => console.log("  ", JSON.stringify(it).slice(0, 300)));
      } else {
        console.log("Empty / scalar");
      }
    }
  } else if (typeof r.body === "object") {
    console.log(r.body?.error?.message?.value || JSON.stringify(r.body).slice(0, 150));
  }
}

// Now look at AdditionalExpenses with FULL fields (no $select)
console.log("\n\n== AdditionalExpenses(2) full ==");
const r2 = await req("GET", "AdditionalExpenses(2)", { cookies });
if (r2.status === 200) {
  console.log(JSON.stringify(r2.body, null, 2).slice(0, 3000));
}

// Check User-Defined Tables for "ExpnsCode"
console.log("\n== UserDefinedTables filter ExpnsCode ==");
const udt = await req("GET", "UserDefinedTablesMD?$filter=substringof('Expns',TableName)", { cookies });
console.log(`Status ${udt.status}:`, JSON.stringify(udt.body).slice(0, 500));

await req("POST", "Logout", { cookies });
