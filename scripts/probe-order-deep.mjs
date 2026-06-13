/** Analyse en profondeur une commande SAP : lots, prix, taxes, vendeur, conditionnement. */
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

// === 1. Trouve une commande FRAMB12PD existante (batch-managed) ===
console.log("\n== 1. Order existant avec FRAMB12PD ==");
const ord = await req("GET",
  "Orders?$top=3&$orderby=DocEntry desc&$filter=DocumentLines/any(l: l/ItemCode eq 'FRAMB12PD')&$select=DocEntry,DocNum,DocDate,CardCode,SalesPersonCode,DocTotal,VatSum,DocumentLines",
  { cookies });
const orders = ord.body?.value || [];
if (orders.length === 0) {
  console.log("Aucun. On essaie sans filter…");
  const any = await req("GET", "Orders?$top=2&$orderby=DocEntry desc", { cookies });
  orders.push(...(any.body?.value || []));
}
if (orders[0]) {
  const o = orders[0];
  console.log(`Order #${o.DocNum} (DocEntry ${o.DocEntry}) | ${o.CardCode} | total HT/TTC: ${o.DocTotal} | VatSum: ${o.VatSum} | SalesPerson: ${o.SalesPersonCode}`);
  console.log("\nLignes — tous les champs avec valeur :");
  (o.DocumentLines || []).forEach((l, i) => {
    console.log(`\n--- Ligne ${i + 1} : ${l.ItemCode} ---`);
    const keys = Object.keys(l).filter(k => l[k] != null && l[k] !== "" && l[k] !== 0 && !Array.isArray(l[k]) && typeof l[k] !== "object");
    keys.forEach(k => console.log(`  ${k.padEnd(25)} : ${JSON.stringify(l[k])}`));
    // Print arrays/objects separately
    if (l.BatchNumbers?.length) {
      console.log(`  BatchNumbers:`);
      l.BatchNumbers.forEach(b => console.log(`    -`, JSON.stringify(b)));
    }
    if (l.DocumentLinesAdditionalExpenses?.length) {
      console.log(`  AdditionalExpenses:`);
      l.DocumentLinesAdditionalExpenses.forEach(e => console.log(`    -`, JSON.stringify(e)));
    }
  });
}

// === 2. Stratégies de prix : essai 1 — sans price (utilise PriceList) ===
console.log("\n\n== 2. Test création SANS Price — laisse SAP appliquer le tarif client ==");
const cardCode = "AAUXERRE";
const itemCode = "FRAMB12PD";

// On récupère le 1er lot dispo pour ce produit
const batch = await req("GET",
  `BatchNumberDetails?$top=1&$filter=ItemCode eq '${itemCode}' and Status eq 'bdsStatus_Released'&$select=Batch,SystemNumber`,
  { cookies });
const lot = batch.body?.value?.[0]?.Batch;
console.log("Lot dispo:", lot);

const today = new Date().toISOString().slice(0, 10);
const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);

const p1 = {
  CardCode: cardCode,
  DocDate: today, DocDueDate: tomorrow,
  Comments: "Test 2 : sans Price, sans BatchNumbers",
  DocumentLines: [
    { ItemCode: itemCode, Quantity: 1, WarehouseCode: "01" },
  ],
};
const r1 = await req("POST", "Orders", { cookies, body: p1 });
console.log(`Status: ${r1.status} | DocNum: ${r1.body?.DocNum} | DocTotal: ${r1.body?.DocTotal} | VatSum: ${r1.body?.VatSum}`);
if (r1.status >= 400) console.log("Err:", JSON.stringify(r1.body, null, 2));

// === 3. Stratégie : avec BatchNumbers ===
console.log("\n== 3. Test avec BatchNumbers ==");
const p2 = {
  CardCode: cardCode,
  DocDate: today, DocDueDate: tomorrow,
  Comments: "Test 3 : avec BatchNumbers",
  DocumentLines: [
    {
      ItemCode: itemCode, Quantity: 1, WarehouseCode: "01",
      BatchNumbers: lot ? [{ BatchNumber: lot, Quantity: 1 }] : undefined,
    },
  ],
};
const r2 = await req("POST", "Orders", { cookies, body: p2 });
console.log(`Status: ${r2.status} | DocNum: ${r2.body?.DocNum} | DocTotal: ${r2.body?.DocTotal} | VatSum: ${r2.body?.VatSum}`);
if (r2.status >= 400) console.log("Err:", JSON.stringify(r2.body, null, 2));

// === 4. Lookup PriceList du customer ===
console.log("\n== 4. PriceList du customer AAUXERRE ==");
const cust = await req("GET",
  `BusinessPartners('${cardCode}')?$select=CardCode,CardName,PriceListNum,VatLiable,Currency`,
  { cookies });
console.log(JSON.stringify(cust.body, null, 2));

// === 5. Prix du FRAMB12PD pour ce customer ===
console.log("\n== 5. Prix FRAMB12PD pour AAUXERRE (SpecialPrices) ==");
const sp = await req("GET",
  `SpecialPrices?$top=3&$filter=CardCode eq '${cardCode}' and ItemCode eq '${itemCode}'`,
  { cookies });
console.log("Status:", sp.status, "Found:", sp.body?.value?.length || 0);
if (sp.body?.value?.[0]) console.log(JSON.stringify(sp.body.value[0], null, 2));

await req("POST", "Logout", { cookies });
