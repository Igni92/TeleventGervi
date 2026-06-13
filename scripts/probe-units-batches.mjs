/** Probe SAP B1 : unités (vente vs stock vs achat) + lots avec prix d'achat. */
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
console.log("Login:", login.status, "\n");

// ── 1. Find a Framboise to inspect unit fields ─────────────
console.log("== 1. Framboise — unités complètes ==");
const fram = await req(
  "GET",
  "Items?$top=2&$filter=substringof('Framboise', ItemName) eq true&$select=ItemCode,ItemName,SalesUnit,SalesUOM,InventoryUOM,InventoryUnit,PurchaseUnit,PurchaseUOM,NumInSale,NumInBuy,SalesItemsPerUnit,PurchaseItemsPerUnit,InventoryWeight,SalesQtyPerPackUnit,PurchaseQtyPerPackUnit,SalesPackagingUnit,PurchasePackagingUnit,UoMGroupEntry",
  { cookies },
);
if (fram.status === 200) {
  (fram.body.value || []).forEach((it) => {
    console.log(`\n  ${it.ItemCode} | ${it.ItemName}`);
    Object.entries(it).forEach(([k, v]) => {
      if (k !== "ItemCode" && k !== "ItemName" && v !== null && v !== undefined && v !== 0) {
        console.log(`    ${k.padEnd(28)} : ${JSON.stringify(v)}`);
      }
    });
  });
} else {
  console.log("Error:", fram.body);
}

// ── 2. Get a sample product with batches ───────────────────
console.log("\n== 2. Articles batch-managed avec stock ==");
const batchItems = await req(
  "GET",
  "Items?$top=5&$filter=ManageBatchNumbers eq 'tYES'&$select=ItemCode,ItemName,QuantityOnStock",
  { cookies },
);
console.log((batchItems.body.value || []).map(i => `${i.ItemCode} | ${i.ItemName} | stock=${i.QuantityOnStock}`).join("\n"));

// ── 3. BatchNumberDetails — explore fields ─────────────────
console.log("\n== 3. BatchNumberDetails — exemples (5 derniers) ==");
const batches = await req(
  "GET",
  "BatchNumberDetails?$top=5&$orderby=SystemNumber desc",
  { cookies },
);
if (batches.body.value?.[0]) {
  console.log("Fields disponibles :", Object.keys(batches.body.value[0]).join(", "));
  console.log("\nExemple :");
  console.log(JSON.stringify(batches.body.value[0], null, 2));
} else {
  console.log("Aucun lot trouvé. Body :", JSON.stringify(batches.body, null, 2));
}

// ── 4. Alternative: SerialNumberDetails / Layer info? ──────
console.log("\n== 4. Test prix lot via GoodsReceiptPOs (recent) ==");
const grpos = await req(
  "GET",
  "PurchaseDeliveryNotes?$top=2&$orderby=DocEntry desc&$select=DocEntry,DocNum,DocDate,CardName,DocTotal,DocumentLines",
  { cookies },
);
if (grpos.body.value?.[0]) {
  const doc = grpos.body.value[0];
  console.log(`Doc ${doc.DocNum} | ${doc.DocDate} | ${doc.CardName} | total ${doc.DocTotal}`);
  if (doc.DocumentLines?.[0]) {
    console.log("Ligne 1 fields :", Object.keys(doc.DocumentLines[0]).filter(k => doc.DocumentLines[0][k] != null && doc.DocumentLines[0][k] !== 0 && doc.DocumentLines[0][k] !== "").slice(0, 25).join(", "));
  }
} else {
  console.log("Pas de PurchaseDeliveryNotes :", grpos.body?.error?.message?.value || grpos.body);
}

await req("POST", "Logout", { cookies });
