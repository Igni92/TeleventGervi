/** Liste les AdditionalExpenses avec AbsEntry, et inspecte la structure
 *  DocumentLinesAdditionalExpenses sur un order existant.
 */
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

// 1. Liste complète des AdditionalExpenses
console.log("== AdditionalExpenses ==");
const ae = await req("GET", "AdditionalExpenses?$top=50&$select=AbsEntry,Name,U_Taux,OutputVATGroup,TaxLiable,RevenuesAccount,ExpenseAccount", { cookies });
const expenses = ae.body?.value || [];
console.log(`Total: ${expenses.length}`);
for (const e of expenses) {
  console.log(`\n  AbsEntry=${e.AbsEntry} | ${e.Name}`);
  console.log(`    Revenue=${e.RevenuesAccount} Expense=${e.ExpenseAccount}`);
  console.log(`    TaxLiable=${e.TaxLiable} VATGroup=${e.OutputVATGroup} U_Taux=${e.U_Taux}`);
  console.log(`    FixedRevenue=${e.FixedAmountRevenues} FixedExpense=${e.FixedAmountExpenses}`);
  // dump des champs U_*
  const uFields = Object.entries(e).filter(([k, v]) => k.startsWith("U_") && v != null && v !== "");
  if (uFields.length > 0) {
    console.log(`    U_*: ${uFields.map(([k, v]) => `${k}=${v}`).join(", ")}`);
  }
}

// 2. Cherche un order avec DocumentAdditionalExpenses ou DocumentLinesAdditionalExpenses
console.log("\n\n== Recherche orders avec AdditionalExpenses appliqués ==");
const orders = await req("GET", "Orders?$top=50&$orderby=DocEntry desc", { cookies });
for (const o of (orders.body?.value || [])) {
  // Doc-level
  const docAE = o.DocumentAdditionalExpenses || [];
  if (docAE.length > 0) {
    console.log(`\nOrder #${o.DocNum} (DocEntry ${o.DocEntry}) — DocumentAdditionalExpenses:`);
    for (const ex of docAE) {
      console.log(`  Keys: ${Object.keys(ex).join(", ")}`);
      Object.entries(ex).filter(([_, v]) => v != null && v !== 0 && v !== "" && v !== "tNO").forEach(
        ([k, v]) => console.log(`    ${k} = ${JSON.stringify(v)}`)
      );
      break;
    }
  }
  // Line-level
  for (const l of (o.DocumentLines || [])) {
    const lineAE = l.DocumentLinesAdditionalExpenses || l.LineAdditionalExpenses || [];
    if (lineAE.length > 0) {
      console.log(`\nOrder #${o.DocNum} ligne ${l.ItemCode} — DocumentLinesAdditionalExpenses:`);
      for (const ex of lineAE) {
        console.log(`  Keys: ${Object.keys(ex).join(", ")}`);
        Object.entries(ex).filter(([_, v]) => v != null && v !== 0 && v !== "" && v !== "tNO").forEach(
          ([k, v]) => console.log(`    ${k} = ${JSON.stringify(v)}`)
        );
      }
      // Et le prix de la ligne pour comparer
      console.log(`  Prix ligne: Price=${l.Price} UnitPrice=${l.UnitPrice} PriceAfterVAT=${l.PriceAfterVAT} GrossPrice=${l.GrossPrice} LineTotal=${l.LineTotal} Quantity=${l.Quantity}`);
      break;
    }
  }
}

// 3. Inspect un order DETAILED via DocEntry direct (full payload)
console.log("\n\n== Order le plus récent — payload complet (lignes seulement) ==");
const recent = orders.body?.value?.[0];
if (recent) {
  const full = await req("GET", `Orders(${recent.DocEntry})`, { cookies });
  if (full.status === 200 && full.body?.DocumentLines?.[0]) {
    const l = full.body.DocumentLines[0];
    console.log(`Order #${full.body.DocNum} ligne 1 (${l.ItemCode}):`);
    // tous les champs ≠ null/0/""
    const interesting = Object.entries(l).filter(([k, v]) =>
      v != null && v !== 0 && v !== "" && v !== "tNO" && !Array.isArray(v) || (Array.isArray(v) && v.length > 0)
    );
    interesting.forEach(([k, v]) => {
      if (Array.isArray(v)) {
        console.log(`  ${k}: [${v.length} items] -> ${JSON.stringify(v[0]).slice(0, 250)}`);
      } else {
        console.log(`  ${k} = ${JSON.stringify(v)}`);
      }
    });
  }
}

await req("POST", "Logout", { cookies });
