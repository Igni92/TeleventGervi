/** Test : commande avec découpe multi-entrepôt (même article, 2 entrepôts). */
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

// FRAMB12PD : 6 colis répartis 5×000 + 1×01 (packDivisor 12 → 60 et 12 pie)
const payload = {
  CardCode: "AAUXERRE", DocDueDate: "2026-06-03",
  Comments: "TEST découpe multi-entrepôt — à supprimer",
  DocumentLines: [
    { ItemCode: "FRAMB12PD", Quantity: 60, UnitPrice: 2.30, Price: 2.30, WarehouseCode: "000", U_NoLot: "EM0000", U_NomMag: "A/C - A/D",
      DocumentLineAdditionalExpenses: [
        { GroupCode: 1, ExpenseCode: 2, LineTotal: Math.round(60*2.30*0.0021*100)/100 },
        { GroupCode: 2, ExpenseCode: 3, LineTotal: 0.10 },  // 5 colis × 0.02
      ] },
    { ItemCode: "FRAMB12PD", Quantity: 12, UnitPrice: 2.30, Price: 2.30, WarehouseCode: "01", U_NoLot: "EM0000", U_NomMag: "Stock",
      DocumentLineAdditionalExpenses: [
        { GroupCode: 1, ExpenseCode: 2, LineTotal: Math.round(12*2.30*0.0021*100)/100 },
        { GroupCode: 2, ExpenseCode: 3, LineTotal: 0.02 },  // 1 colis × 0.02
      ] },
  ],
};
console.log("=== POST commande découpée ===");
const r = await req("POST", "Orders", { cookies, body: payload });
console.log("Status:", r.status);
if (r.status >= 200 && r.status < 300) {
  console.log(`✅ DocNum ${r.body.DocNum} | DocTotal ${r.body.DocTotal} | VatSum ${r.body.VatSum}`);
  const e = await req("GET", `Orders(${r.body.DocEntry})`, { cookies });
  for (const l of e.body.DocumentLines) {
    console.log(`  Ligne ${l.LineNum}: ${l.ItemCode} qty=${l.Quantity} Whs=${l.WarehouseCode} U_NoLot=${l.U_NoLot} U_NomMag=${l.U_NomMag} LineTotal=${l.LineTotal}`);
    for (const le of (l.DocumentLineAdditionalExpenses || []))
      console.log(`      TPF Group=${le.GroupCode} Code=${le.ExpenseCode} Total=${le.LineTotal}`);
  }
} else {
  console.error("❌", JSON.stringify(r.body).slice(0, 800));
}
await req("POST", "Logout", { cookies });
