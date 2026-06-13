/** Probe ITFEL, DDG, et structure prix dans SAP. */
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

// 1. Cherche un order avec ITFEL/DDG renseignés
console.log("== Cherche order avec taxes para-fiscales ==");
const orders = await req("GET", "Orders?$top=30&$orderby=DocEntry desc", { cookies });
for (const o of (orders.body?.value || [])) {
  for (const l of (o.DocumentLines || [])) {
    // Cherche les champs liés à TPF/ITFEL/DDG
    const taxFields = Object.entries(l).filter(([k, v]) =>
      /tax|tpf|itfel|ddg|parafiscal|interprof|garantie/i.test(k) && v != null && v !== 0 && v !== "" && v !== "tNO"
    );
    if (taxFields.length > 2) {
      console.log(`\nOrder #${o.DocNum} | ${o.CardCode} | DocTotal ${o.DocTotal} VatSum ${o.VatSum}`);
      console.log(`Ligne ${l.ItemCode}:`);
      taxFields.forEach(([k, v]) => console.log(`  ${k.padEnd(35)} : ${JSON.stringify(v)}`));
      // Et toutes les U_*
      const uFields = Object.entries(l).filter(([k, v]) => k.startsWith("U_") && v != null && v !== 0 && v !== "");
      if (uFields.length > 0) {
        console.log("  U_*:");
        uFields.forEach(([k, v]) => console.log(`    ${k.padEnd(33)} : ${JSON.stringify(v)}`));
      }
      // Champs liés au prix
      console.log("  Prix / unité:");
      ["Price", "UnitPrice", "PriceAfterVAT", "GrossPrice", "GrossBuyPrice", "LineTotal", "GrossTotal",
       "PackageQuantity", "UnitsOfMeasurment", "MeasureUnit", "UoMEntry", "UoMCode",
       "Quantity", "InventoryQuantity"].forEach(k => {
        if (l[k] != null && l[k] !== 0 && l[k] !== "") console.log(`    ${k.padEnd(20)} : ${JSON.stringify(l[k])}`);
      });
      break;
    }
  }
}

// 2. Cherche un TaxCode "ITFEL" via /TaxCodes
console.log("\n== TaxCodes dispo ==");
const tc = await req("GET", "TaxCodes?$top=30&$select=Code,Name,Rate,Group", { cookies });
(tc.body?.value || []).forEach(t => console.log(`  ${t.Code?.padEnd(8)} | rate=${t.Rate} | ${t.Name}`));

// 3. Inspect structure complete de la dernière commande
console.log("\n== Order avec ITFEL renseigné — structure complète ==");
const lastWithItfel = await req("GET",
  "Orders?$top=10&$orderby=DocEntry desc&$filter=DocumentLines/any(l: l/U_ITFEL ne '0')",
  { cookies });
if (lastWithItfel.status === 200 && lastWithItfel.body.value?.[0]) {
  const o = lastWithItfel.body.value[0];
  const l = o.DocumentLines[0];
  console.log(`Order #${o.DocNum}`);
  Object.entries(l).filter(([k]) => k.startsWith("U_")).forEach(([k, v]) =>
    console.log(`  ${k.padEnd(30)} : ${JSON.stringify(v)}`)
  );
}

await req("POST", "Logout", { cookies });
