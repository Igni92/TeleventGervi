/** Probe SAP B1 to understand the data shape: how many items, which warehouses, batch-managed % etc. */
import https from "node:https";
import fs from "node:fs";
import { URL } from "node:url";

function loadEnv(p) {
  if (!fs.existsSync(p)) return;
  for (const line of fs.readFileSync(p, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
  }
}
loadEnv(".env.local");

const BASE = process.env.SAP_B1_BASE_URL;

function req(method, path, { cookies = "", body = null } = {}) {
  return new Promise((resolve, reject) => {
    const target = new URL(path, BASE.endsWith("/") ? BASE : BASE + "/");
    const r = https.request({
      hostname: target.hostname,
      port: target.port || 443,
      path: target.pathname + target.search,
      method,
      rejectUnauthorized: false,
      headers: {
        "Content-Type": "application/json",
        "Accept": "application/json",
        Prefer: "odata.maxpagesize=500",
        ...(cookies ? { Cookie: cookies } : {}),
      },
    }, (res) => {
      let d = ""; res.on("data", (c) => d += c);
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

// Login
const login = await req("POST", "Login", {
  body: {
    CompanyDB: process.env.SAP_B1_COMPANY_DB,
    UserName: process.env.SAP_B1_USERNAME,
    Password: process.env.SAP_B1_PASSWORD,
  },
});
const cookies = (login.headers["set-cookie"] || []).map((c) => c.split(";")[0]).join("; ");

// 1. Total item count
console.log("== 1. Articles ==");
const count = await req("GET", "Items/$count", { cookies });
console.log("Total articles dans SAP :", count.body);

// 2. Sample of items with stock > 0
console.log("\n== 2. Articles AVEC stock (échantillon 5) ==");
const withStock = await req(
  "GET",
  "Items?$top=5&$filter=QuantityOnStock gt 0&$select=ItemCode,ItemName,QuantityOnStock,ManageBatchNumbers,ItemsGroupCode,SalesUnit",
  { cookies },
);
(withStock.body.value || []).forEach((it) => {
  console.log(`  • ${it.ItemCode} | ${it.ItemName} | stock=${it.QuantityOnStock} | unit=${it.SalesUnit} | batch=${it.ManageBatchNumbers} | group=${it.ItemsGroupCode}`);
});

// 3. Total batch-managed items
console.log("\n== 3. Articles gérés en lots ==");
const batchCount = await req("GET", "Items/$count?$filter=ManageBatchNumbers eq 'tYES'", { cookies });
console.log("Articles batch-managed :", batchCount.body);

// 4. List warehouses
console.log("\n== 4. Entrepôts ==");
const wh = await req("GET", "Warehouses?$select=WarehouseCode,WarehouseName,Inactive,BusinessPlaceID,Street,City&$top=50", { cookies });
(wh.body.value || []).forEach((w) => {
  console.log(`  • ${w.WarehouseCode.padEnd(5)} | ${(w.WarehouseName || '').padEnd(35)} | inactive=${w.Inactive} | place=${w.BusinessPlaceID} | ville=${w.City || '?'}`);
});

// 5. Item groups
console.log("\n== 5. Groupes d'articles (top 20) ==");
const groups = await req("GET", "ItemGroups?$top=20&$select=Number,GroupName", { cookies });
(groups.body.value || []).forEach((g) => console.log(`  • ${String(g.Number).padEnd(5)} | ${g.GroupName}`));

// 6. Sample batches
console.log("\n== 6. Lots actifs récents (5) ==");
const batches = await req(
  "GET",
  "BatchNumberDetails?$top=5&$orderby=SystemNumber desc&$select=ItemCode,Batch,ExpirationDate,ManufacturingDate,Status,Quantity",
  { cookies },
);
(batches.body.value || []).forEach((b) => {
  console.log(`  • Lot ${b.Batch} | ${b.ItemCode} | qté=${b.Quantity} | exp=${b.ExpirationDate} | statut=${b.Status}`);
});

// 7. Item with batches + stock > 0
console.log("\n== 7. Article batch-managé AVEC stock ==");
const batchAndStock = await req(
  "GET",
  "Items?$top=1&$filter=ManageBatchNumbers eq 'tYES' and QuantityOnStock gt 0&$select=ItemCode,ItemName,QuantityOnStock,ItemWarehouseInfoCollection",
  { cookies },
);
const sample = batchAndStock.body.value?.[0];
if (sample) {
  console.log(`  ${sample.ItemCode} | ${sample.ItemName} | stock total: ${sample.QuantityOnStock}`);
  (sample.ItemWarehouseInfoCollection || []).filter((w) => w.InStock > 0).forEach((w) => {
    console.log(`    └ ${w.WarehouseCode} : ${w.InStock} (committed: ${w.Committed}, ordered: ${w.Ordered})`);
  });
  // Batches for this item
  const ib = await req("GET", `BatchNumberDetails?$filter=ItemCode eq '${sample.ItemCode}' and Status eq 'bdsStatus_Released'&$select=Batch,Quantity,ExpirationDate,WhsCode&$top=10`, { cookies });
  console.log("  Lots actifs :");
  (ib.body.value || []).forEach((b) => console.log(`    └ ${b.Batch} | qté=${b.Quantity} | exp=${b.ExpirationDate} | whs=${b.WhsCode}`));
}

await req("POST", "Logout", { cookies });
console.log("\n🔚 Done.");
