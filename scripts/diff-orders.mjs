/** Compare order TeleVent vs manuel pour identifier la diff dans taxes/prix/lot. */
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

for (const docNum of [24011194, 24011195]) {
  const r = await req("GET", `Orders?$filter=DocNum eq ${docNum}`, { cookies });
  const o = r.body?.value?.[0];
  if (!o) { console.log(`#${docNum} NOT FOUND`); continue; }
  console.log(`\n\n============ Order #${docNum} (DocEntry ${o.DocEntry}) ============`);
  console.log(`CardCode=${o.CardCode} | DocTotal=${o.DocTotal} | VatSum=${o.VatSum} | DocTotalSys=${o.DocTotalSys}`);
  console.log(`Comments=${o.Comments?.slice(0,80)}`);
  console.log(`\n-- Lines --`);
  for (const l of (o.DocumentLines || [])) {
    console.log(`\n  ${l.ItemCode} | qty=${l.Quantity} ${l.MeasureUnit} | Price=${l.Price} UnitPrice=${l.UnitPrice} PriceAfterVAT=${l.PriceAfterVAT} GrossPrice=${l.GrossPrice}`);
    console.log(`    LineTotal=${l.LineTotal} GrossTotal=${l.GrossTotal} TaxTotal=${l.TaxTotal} TaxPercent=${l.TaxPercentagePerRow} VatGroup=${l.VatGroup}`);
    console.log(`    WhsCode=${l.WarehouseCode} U_NoLot=${l.U_NoLot} U_NomMag=${l.U_NomMag} U_GER_Pays=${l.U_GER_Pays} U_GER_Marque=${l.U_GER_Marque} U_GER_Condi=${l.U_GER_Condi}`);
    // Batch numbers
    const bn = l.BatchNumbers || [];
    if (bn.length > 0) console.log(`    BatchNumbers: ${bn.map(b => `${b.BatchNumber}×${b.Quantity}`).join(", ")}`);
    // Line-level expenses
    const lae = l.DocumentLinesAdditionalExpenses || l.LineAdditionalExpenses || [];
    if (lae.length > 0) {
      console.log(`    Line expenses: ${lae.length}`);
      lae.forEach(e => console.log(`      ExpenseCode=${e.ExpenseCode} LineTotal=${e.LineTotal} TaxSum=${e.TaxSum} DistMethod=${e.DistributionMethod}`));
    }
    // U_* sur la ligne
    const us = Object.entries(l).filter(([k, v]) => k.startsWith("U_") && v != null && v !== "" && v !== 0);
    if (us.length > 0) console.log(`    Tous U_*: ${us.map(([k, v]) => `${k}=${v}`).join(", ")}`);
  }
  // Document expenses
  const dae = o.DocumentAdditionalExpenses || [];
  console.log(`\n-- DocumentAdditionalExpenses (${dae.length}) --`);
  dae.forEach(e => {
    console.log(`  ExpenseCode=${e.ExpenseCode} LineTotal=${e.LineTotal} LineGross=${e.LineGross} TaxSum=${e.TaxSum} TaxPercent=${e.TaxPercent} VatGroup=${e.VatGroup} DistMethod=${e.DistributionMethod} Status=${e.Status}`);
  });
  // U_* doc-level
  const docU = Object.entries(o).filter(([k, v]) => k.startsWith("U_") && v != null && v !== "" && v !== 0);
  if (docU.length > 0) {
    console.log(`\n-- Doc U_* --`);
    docU.forEach(([k, v]) => console.log(`  ${k} = ${JSON.stringify(v).slice(0,80)}`));
  }
}
await req("POST", "Logout", { cookies });
