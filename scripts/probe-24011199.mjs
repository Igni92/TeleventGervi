/** Examine #24011199 (manuel avec bonnes taxes) - cherche TPF2/TPF3 et tout U_*. */
import https from "node:https"; import fs from "node:fs"; import { URL } from "node:url";
function loadEnv(p) {
  if (!fs.existsSync(p)) return;
  for (const line of fs.readFileSync(p, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (m && !process.env[m[1]]) { let v = m[2].trim();
      if ((v.startsWith('"') && v.endsWith('"'))) v = v.slice(1, -1);
      v = v.replace(/\\\$/g, "$"); process.env[m[1]] = v;
    }
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

const r = await req("GET", `Orders?$filter=DocNum eq 24011199`, { cookies });
const o = r.body?.value?.[0];
if (!o) { console.log("Not in Orders, try DeliveryNotes...");
  const r2 = await req("GET", `DeliveryNotes?$filter=DocNum eq 24011199`, { cookies });
  console.log("DeliveryNotes status:", r2.status, "value len:", r2.body?.value?.length);
  process.exit(0);
}
console.log(`=== Order #${o.DocNum} (DocEntry ${o.DocEntry}) ===`);
console.log(`DocTotal=${o.DocTotal} VatSum=${o.VatSum} HT=${(o.DocTotal-o.VatSum).toFixed(2)} CardCode=${o.CardCode}`);

// === TOUS les champs de doc ===
console.log("\n--- Tous champs Doc-level (non-null/0) ---");
Object.entries(o).filter(([k, v]) => {
  if (Array.isArray(v)) return false;
  return v !== null && v !== 0 && v !== "" && v !== "tNO" && v !== "N";
}).forEach(([k, v]) => {
  const isU = k.startsWith("U_") || /tpf|itfel|ddg|interfel|ctifl|tax|vat/i.test(k);
  const tag = isU ? "★" : " ";
  console.log(`  ${tag} ${k.padEnd(35)} = ${JSON.stringify(v).slice(0, 120)}`);
});

// === Lignes - TOUS champs U_* / TPF / tax ===
console.log("\n--- Lignes (TPF*, U_*, taxes) ---");
for (const l of (o.DocumentLines || [])) {
  console.log(`\n  Ligne ${l.LineNum}: ${l.ItemCode} qty=${l.Quantity} ${l.MeasureUnit} Price=${l.Price} LineTotal=${l.LineTotal}`);
  Object.entries(l).filter(([k, v]) => {
    if (Array.isArray(v)) return false;
    if (v === null || v === 0 || v === "" || v === "tNO") return false;
    return k.startsWith("U_") || /tpf|itfel|ddg|interfel|ctifl/i.test(k);
  }).forEach(([k, v]) => console.log(`    ★ ${k.padEnd(30)} = ${JSON.stringify(v).slice(0, 100)}`));
  // Tax-related fields toujours
  ["TaxCode","TaxType","TaxPercentagePerRow","TaxStatus","TaxTotal","TaxOnly","VatGroup","LineTaxJurisdictions"].forEach(k => {
    if (l[k] != null && l[k] !== "" && l[k] !== 0 && (!Array.isArray(l[k]) || l[k].length > 0)) console.log(`    · ${k.padEnd(30)} = ${JSON.stringify(l[k]).slice(0,100)}`);
  });
}
// DocumentAdditionalExpenses
console.log("\n--- DocumentAdditionalExpenses ---");
(o.DocumentAdditionalExpenses || []).forEach((e) => {
  console.log(`  ExpenseCode=${e.ExpenseCode} LineTotal=${e.LineTotal} LineGross=${e.LineGross} TaxSum=${e.TaxSum} TaxPercent=${e.TaxPercent} VatGroup=${e.VatGroup} Dist=${e.DistributionMethod}`);
});
await req("POST", "Logout", { cookies });
