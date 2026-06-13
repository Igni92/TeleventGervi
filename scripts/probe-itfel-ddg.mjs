/** Trouve ITFEL et DDG : TaxCodes, LineTaxJurisdictions, ParaFiscalTaxes. */
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
      v = v.replace(/\\\$/g, "$");
      process.env[m[1]] = v;
    }
  }
}
loadEnv(".env.local");

const BASE = process.env.SAP_B1_BASE_URL;
function req(method, path, { cookies = "", body = null } = {}) {
  return new Promise((resolve, reject) => {
    const target = new URL(path, BASE + "/");
    const r = https.request({
      hostname: target.hostname, port: target.port || 443,
      path: target.pathname + target.search, method,
      rejectUnauthorized: false,
      headers: { "Content-Type": "application/json", ...(cookies ? { Cookie: cookies } : {}) },
    }, (res) => {
      let d = ""; res.on("data", c => d += c);
      res.on("end", () => {
        let p = d; try { p = JSON.parse(d); } catch {}
        resolve({ status: res.statusCode, headers: res.headers, body: p });
      });
    });
    r.on("error", reject);
    if (body) r.write(JSON.stringify(body));
    r.end();
  });
}

const login = await req("POST", "Login", {
  body: { CompanyDB: process.env.SAP_B1_COMPANY_DB, UserName: process.env.SAP_B1_USERNAME, Password: process.env.SAP_B1_PASSWORD },
});
const cookies = (login.headers["set-cookie"] || []).map(c => c.split(";")[0]).join("; ");

// Try various endpoints related to ITFEL/DDG
const endpoints = [
  "AdditionalExpenses",
  "TaxCodes?$select=Code,Name,Rate,Group",
  "TaxJurisdictions",
  "ParaFiscalTaxes",
  "U_ITFEL_VALUES",
  "DocumentAdditionalExpenses",
];

for (const ep of endpoints) {
  console.log(`\n== ${ep} ==`);
  const r = await req("GET", `${ep}${ep.includes("?") ? "" : "?$top=5"}`, { cookies });
  if (r.status === 200) {
    const items = r.body?.value || (r.body?.value === undefined ? [r.body] : []);
    if (items.length > 0) {
      console.log("Sample keys:", Object.keys(items[0]).join(", "));
      items.slice(0, 3).forEach(it => console.log("  ", JSON.stringify(it).slice(0, 200)));
    } else {
      console.log("Empty");
    }
  } else {
    console.log(`Status ${r.status}: ${r.body?.error?.message?.value || "—"}`);
  }
}

// Get the line of an order with full details to see if there's any field referring to ITFEL/DDG
console.log("\n== Search 'itfel' or 'ddg' in any field of any recent order ==");
const orders = await req("GET", "Orders?$top=5&$orderby=DocEntry desc", { cookies });
for (const o of orders.body?.value || []) {
  // Check doc-level
  const docFields = Object.entries(o).filter(([k]) => /itfel|ddg|parafis|interprof/i.test(k));
  if (docFields.length > 0) {
    console.log(`Order #${o.DocNum} doc-level:`);
    docFields.forEach(([k, v]) => console.log(`  ${k} = ${JSON.stringify(v)}`));
  }
  // Check lines
  for (const l of o.DocumentLines || []) {
    const lineFields = Object.entries(l).filter(([k]) => /itfel|ddg|parafis|interprof/i.test(k));
    if (lineFields.length > 0) {
      console.log(`Order #${o.DocNum} ligne ${l.ItemCode}:`);
      lineFields.forEach(([k, v]) => console.log(`  ${k} = ${JSON.stringify(v)}`));
    }
  }
}

await req("POST", "Logout", { cookies });
