/** Test : crée une commande exactement comme #24011199 pour vérifier que SAP accepte TPF2/TPF3. */
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

// Reproduit #24011199 : FE1SL × 40 kg @ 5.80, FRAMB12PD × 12 @ 2.30, K100 × 104 @ 1.05
const payload = {
  CardCode: "AAUXERRE",
  DocDueDate: "2026-06-03",
  Comments: "TEST TPF2/TPF3 via TeleVent — à supprimer",
  DocumentLines: [
    {
      ItemCode: "FE1SL", Quantity: 40, UnitPrice: 5.80, Price: 5.80,
      U_NoLot: "EM0000",
      DocumentLineAdditionalExpenses: [
        { GroupCode: 1, ExpenseCode: 2, LineTotal: 0.49 },  // TPF2 INTERFEL
        { GroupCode: 2, ExpenseCode: 3, LineTotal: 0.80 },  // TPF3 DDG
      ],
    },
    {
      ItemCode: "FRAMB12PD", Quantity: 12, UnitPrice: 2.30, Price: 2.30,
      U_NoLot: "EM0000",
      DocumentLineAdditionalExpenses: [
        { GroupCode: 1, ExpenseCode: 2, LineTotal: 0.06 },
        { GroupCode: 2, ExpenseCode: 3, LineTotal: 0.02 },
      ],
    },
    {
      ItemCode: "K100", Quantity: 104, UnitPrice: 1.05, Price: 1.05,
      U_NoLot: "EM0000",
      DocumentLineAdditionalExpenses: [
        { GroupCode: 1, ExpenseCode: 2, LineTotal: 0.23 },
        { GroupCode: 2, ExpenseCode: 3, LineTotal: 0.02 },
      ],
    },
  ],
};

console.log("=== POST /Orders dry-run ===");
const r = await req("POST", "Orders", { cookies, body: payload });
console.log("Status:", r.status);
if (r.status >= 200 && r.status < 300) {
  console.log("✅ Created DocNum:", r.body.DocNum, "DocEntry:", r.body.DocEntry);
  console.log("DocTotal:", r.body.DocTotal, "VatSum:", r.body.VatSum);
  // refetch
  const e = await req("GET", `Orders(${r.body.DocEntry})`, { cookies });
  for (const l of e.body.DocumentLines) {
    console.log(`\n  ${l.ItemCode} qty=${l.Quantity} LineTotal=${l.LineTotal}`);
    for (const le of (l.DocumentLineAdditionalExpenses || [])) {
      console.log(`    Group=${le.GroupCode} Code=${le.ExpenseCode} Total=${le.LineTotal} TaxSum=${le.TaxSum} TaxPct=${le.TaxPercent} VAT=${le.VatGroup}`);
    }
  }
} else {
  console.error("❌ Failed:", JSON.stringify(r.body, null, 2).slice(0, 1200));
}
await req("POST", "Logout", { cookies });
