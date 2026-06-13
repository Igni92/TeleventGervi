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

const r = await req("GET", `Orders(128622)`, { cookies });
const o = r.body;
console.log(`Order #${o.DocNum} | HT lignes = ${o.DocumentLines.reduce((s,l)=>s+(l.LineTotal||0),0).toFixed(2)} | DocTotal=${o.DocTotal} VatSum=${o.VatSum}`);
console.log(`Σ Line tax = ${o.DocumentLines.reduce((s,l)=>s+(l.TaxTotal||0),0).toFixed(2)}\n`);

for (const l of o.DocumentLines) {
  console.log(`\n=== Ligne ${l.LineNum} : ${l.ItemCode} (qty=${l.Quantity}, price=${l.Price}, LineTotal=${l.LineTotal}) ===`);
  const expenses = l.DocumentLineAdditionalExpenses || [];
  console.log(`  ${expenses.length} DocumentLineAdditionalExpenses :`);
  for (const e of expenses) {
    // Print TOUS les champs non-null
    const fields = Object.entries(e).filter(([k, v]) => v != null && v !== "" && v !== 0 && v !== "tNO").map(([k,v]) => `${k}=${JSON.stringify(v)}`).join(" ");
    console.log(`    ${fields}`);
  }
}

// === Master AdditionalExpenses pour confirmer mapping ExpensCode ===
console.log("\n=== Master AdditionalExpenses (rappel) ===");
const ae = await req("GET", "AdditionalExpenses?$top=10", { cookies });
for (const e of (ae.body?.value || [])) {
  console.log(`  ExpensCode=${e.ExpensCode} | ${e.Name} | U_Taux=${e.U_Taux} | VAT=${e.OutputVATGroup}`);
}
await req("POST", "Logout", { cookies });
