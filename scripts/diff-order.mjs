/** Compare un order créé via SAP UI vs via API : trouve les champs manquants. */
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
console.log("Login:", login.status);

// 1. Item master FRAMB12PD pour voir TOUS les champs custom (U_*)
console.log("\n== 1. Item FRAMB12PD — TOUS les U_* (champs custom) ==");
const item = await req("GET", "Items('FRAMB12PD')", { cookies });
if (item.status === 200) {
  const u = Object.entries(item.body).filter(([k, v]) => k.startsWith("U_") && v !== null && v !== "" && v !== undefined);
  u.forEach(([k, v]) => console.log(`  ${k.padEnd(35)} : ${JSON.stringify(v)}`));
  console.log("\n  ManageBatchNumbers :", item.body.ManageBatchNumbers);
  console.log("  ManageSerialNumbers:", item.body.ManageSerialNumbers);
  console.log("  Mainsupplier       :", item.body.Mainsupplier);
}

// 2. Récup le dernier order créé en TEST avec FRAMB12PD (probablement le user's)
console.log("\n== 2. Dernier order TEST avec FRAMB12PD — tous les champs U_* sur la ligne ==");
const orders = await req("GET",
  "Orders?$top=5&$orderby=DocEntry desc",
  { cookies });
const target = orders.body?.value?.find(o =>
  (o.DocumentLines || []).some(l => l.ItemCode === "FRAMB12PD")
) || orders.body?.value?.[0];
if (target) {
  console.log(`Order #${target.DocNum} | DocEntry ${target.DocEntry} | CardCode ${target.CardCode}`);
  // U_* on document
  const docU = Object.entries(target).filter(([k]) => k.startsWith("U_"));
  if (docU.length) {
    console.log("  Doc-level U_*:");
    docU.forEach(([k, v]) => console.log(`    ${k} : ${JSON.stringify(v)}`));
  }
  // U_* on lines
  (target.DocumentLines || []).forEach((l, i) => {
    const lineU = Object.entries(l).filter(([k]) => k.startsWith("U_"));
    if (lineU.length) {
      console.log(`\n  Ligne ${i + 1} (${l.ItemCode}) U_*:`);
      lineU.forEach(([k, v]) => console.log(`    ${k.padEnd(30)} : ${JSON.stringify(v)}`));
    }
    // also batch / serial
    if (l.BatchNumbers?.length) console.log(`  Ligne ${i + 1} BatchNumbers:`, JSON.stringify(l.BatchNumbers));
    if (l.SerialNumbers?.length) console.log(`  Ligne ${i + 1} SerialNumbers:`, JSON.stringify(l.SerialNumbers));
  });
}

// 3. Compare avec un order créé par le user dans SAP UI (le plus ancien sans "TeleVent" dans Comments)
console.log("\n== 3. Order créé manuellement (sans 'TeleVent' dans comments) pour FRAMB12PD ==");
const all = await req("GET",
  "Orders?$top=20&$orderby=DocEntry desc",
  { cookies });
const manual = all.body?.value?.find(o =>
  !String(o.Comments || "").includes("TeleVent") &&
  (o.DocumentLines || []).some(l => l.ItemCode === "FRAMB12PD")
);
if (manual) {
  console.log(`Order #${manual.DocNum} | CardCode ${manual.CardCode} | DocTotal ${manual.DocTotal}`);
  const l = manual.DocumentLines.find(x => x.ItemCode === "FRAMB12PD");
  console.log("  Quantity:", l.Quantity, "| Price:", l.Price, "| LineTotal:", l.LineTotal, "| TaxTotal:", l.TaxTotal);
  console.log("  UoMEntry:", l.UoMEntry, "| UoMCode:", l.UoMCode, "| MeasureUnit:", l.MeasureUnit);
  console.log("  UnitsOfMeasurment:", l.UnitsOfMeasurment, "| PackageQuantity:", l.PackageQuantity);
  console.log("  UseBaseUnits:", l.UseBaseUnits);
  console.log("  ItemUnitOfMeasurementCollection? ", item.body?.ItemUnitOfMeasurementCollection);
  const lineU = Object.entries(l).filter(([k]) => k.startsWith("U_"));
  console.log("  U_*:", lineU);
}

await req("POST", "Logout", { cookies });
