/** Cherche INTERFEL/DDG/CTIFL dans Orders, DeliveryNotes, Invoices. */
import https from "node:https";
import fs from "node:fs";
import { URL } from "node:url";
function loadEnv(p) {
  if (!fs.existsSync(p)) return;
  for (const line of fs.readFileSync(p, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (m && !process.env[m[1]]) {
      let v = m[2].trim();
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

for (const endpoint of ["Invoices", "DeliveryNotes", "Orders"]) {
  console.log(`\n\n======== ${endpoint} ========`);
  let found = 0;
  let skip = 0;
  while (found < 5 && skip < 2000) {
    const r = await req("GET", `${endpoint}?$top=50&$skip=${skip}&$orderby=DocEntry desc`, { cookies });
    const items = r.body?.value || [];
    if (items.length === 0) break;
    for (const o of items) {
      const dae = (o.DocumentAdditionalExpenses || []).filter(e =>
        (e.ExpenseCode === 1 || e.ExpenseCode === 2 || e.ExpenseCode === 3) && e.LineTotal > 0);
      if (dae.length > 0) {
        found++;
        if (found <= 5) {
          const ht = (o.DocTotal ?? 0) - (o.VatSum ?? 0);
          console.log(`\n${endpoint} #${o.DocNum} | DocTotal=${o.DocTotal} HT≈${ht.toFixed(2)} VatSum=${o.VatSum} CardCode=${o.CardCode}`);
          for (const e of dae) {
            const label = e.ExpenseCode === 1 ? "CTIFL" : e.ExpenseCode === 2 ? "INTERFEL" : "DROIT DE GARDE";
            console.log(`  ${label.padEnd(15)} LineTotal=${e.LineTotal} TaxSum=${e.TaxSum} TaxPct=${e.TaxPercent} DistMethod=${e.DistributionMethod}`);
          }
          // Affiche les U_* doc pour comprendre
          const docU = Object.entries(o).filter(([k, v]) => k.startsWith("U_") && v != null && v !== "" && v !== 0);
          if (docU.length > 0) {
            console.log(`  U_*: ${docU.slice(0, 8).map(([k, v]) => `${k}=${JSON.stringify(v).slice(0, 30)}`).join(", ")}`);
          }
          // Poids total des lignes
          let totalKg = 0;
          let totalHT = 0;
          for (const l of (o.DocumentLines || [])) {
            const w = (l.Quantity || 0) * (l.GrossBuyPrice ? 0 : 0); // pas dispo
            totalHT += (l.LineTotal || 0);
          }
          console.log(`  Σ lignes HT=${totalHT.toFixed(2)}`);
        }
      }
    }
    skip += items.length;
  }
  console.log(`\n[total] ${found} ${endpoint} avec CTIFL/INTERFEL/DDG`);
}
await req("POST", "Logout", { cookies });
