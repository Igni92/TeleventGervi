/** Cherche les orders qui ont VRAIMENT utilisé INTERFEL (ExpenseCode 2) ou DDG (3). */
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

// Walk through many pages
let skip = 0;
let foundItfel = 0;
let foundDdg = 0;
const samples = [];
while (foundItfel < 3 && foundDdg < 3 && skip < 1500) {
  const r = await req("GET", `Orders?$top=50&$orderby=DocEntry desc&$skip=${skip}`, { cookies });
  const orders = r.body?.value || [];
  if (orders.length === 0) break;
  for (const o of orders) {
    for (const ex of (o.DocumentAdditionalExpenses || [])) {
      if ((ex.ExpenseCode === 2 || ex.ExpenseCode === 3) && ex.LineTotal > 0) {
        const label = ex.ExpenseCode === 2 ? "INTERFEL" : "DROIT DE GARDE";
        if (ex.ExpenseCode === 2) foundItfel++;
        else foundDdg++;
        if ((ex.ExpenseCode === 2 && foundItfel <= 3) || (ex.ExpenseCode === 3 && foundDdg <= 3)) {
          samples.push({ docNum: o.DocNum, label, ex, docTotal: o.DocTotal, docTotalHT: o.DocTotal - o.VatSum, vatSum: o.VatSum });
        }
      }
    }
  }
  skip += orders.length;
  console.log(`Scanned ${skip} orders. Found ${foundItfel} INTERFEL, ${foundDdg} DDG.`);
}

console.log("\n== Samples ==");
for (const s of samples) {
  console.log(`\nOrder #${s.docNum} | ${s.label}`);
  console.log(`  DocTotal=${s.docTotal} HT=${s.docTotalHT.toFixed(2)} VatSum=${s.vatSum}`);
  console.log(`  Expense: LineTotal=${s.ex.LineTotal} TaxPercent=${s.ex.TaxPercent} TaxSum=${s.ex.TaxSum} DistributionMethod=${s.ex.DistributionMethod}`);
  console.log(`  Ratio LineTotal/HT = ${(s.ex.LineTotal / s.docTotalHT * 100).toFixed(3)}%`);
}

// Also fetch full details for one of those orders to see the lines
if (samples[0]) {
  const o = await req("GET", `Orders?$filter=DocNum eq ${samples[0].docNum}`, { cookies });
  const full = o.body?.value?.[0];
  if (full) {
    console.log(`\n== Full order #${full.DocNum} ==`);
    console.log(`Lines (${full.DocumentLines.length}):`);
    full.DocumentLines.forEach(l => {
      console.log(`  ${l.ItemCode.padEnd(10)} qty=${l.Quantity} price=${l.Price} unitPrice=${l.UnitPrice} lineTotal=${l.LineTotal} grossPrice=${l.GrossPrice} measureUnit=${l.MeasureUnit}`);
    });
    console.log(`All DocumentAdditionalExpenses:`);
    (full.DocumentAdditionalExpenses || []).forEach(ex => {
      console.log(`  ExpenseCode=${ex.ExpenseCode} LineTotal=${ex.LineTotal} TaxPercent=${ex.TaxPercent} DistMethod=${ex.DistributionMethod}`);
    });
  }
}

await req("POST", "Logout", { cookies });
