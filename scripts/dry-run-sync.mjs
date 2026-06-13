/**
 * Dry-run du sync : valide la requête SAP + filtrage sans toucher à Prisma.
 * Montre combien d'articles seront synchronisés vs filtrés en emballage.
 */
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
const WAREHOUSES = new Set(["000", "01", "R1"]);
const PACKAGING_GROUPS = new Set([114]);
const NOISE_GROUPS = new Set([100, 104, 105, 111, 112, 117, 121, 126, 128, 130]);

function req(method, path, { cookies = "", body = null, prefer = null } = {}) {
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
        ...(cookies ? { Cookie: cookies } : {}),
        ...(prefer ? { Prefer: prefer } : {}),
      },
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

console.log("🔄 Dry-run sync produits (SAP → DB simulation)\n");

// Login
const login = await req("POST", "Login", {
  body: { CompanyDB: process.env.SAP_B1_COMPANY_DB, UserName: process.env.SAP_B1_USERNAME, Password: process.env.SAP_B1_PASSWORD },
});
const cookies = (login.headers["set-cookie"] || []).map(c => c.split(";")[0]).join("; ");
console.log("✅ Login OK\n");

// Fetch groups
console.log("📦 Chargement des groupes…");
const groups = await req("GET", "ItemGroups?$select=Number,GroupName", { cookies });
const groupMap = new Map((groups.body.value || []).map(g => [g.Number, g.GroupName]));
console.log(`   ${groupMap.size} groupes chargés\n`);

// Fetch all items (paginated — nextLink OR $skip fallback)
console.log("📥 Téléchargement des articles…");
const t0 = Date.now();
let all = [];
const basePath = "Items?$select=ItemCode,ItemName,ItemsGroupCode,SalesUnit,ManageBatchNumbers,QuantityOnStock,ItemWarehouseInfoCollection,Valid,Frozen";
let next = basePath;
let pageNum = 0;
const PAGE_SIZE = 500;
while (next) {
  pageNum++;
  const res = await req("GET", next, { cookies, prefer: `odata.maxpagesize=${PAGE_SIZE}` });
  const batch = res.body.value || [];
  all.push(...batch);
  process.stdout.write(`   page ${pageNum} → ${all.length} items cumulés (batch=${batch.length}, nextLink=${!!res.body["@odata.nextLink"]})\n`);

  if (res.body["@odata.nextLink"]) {
    next = res.body["@odata.nextLink"];
  } else if (batch.length === PAGE_SIZE) {
    // Manual $skip
    next = `${basePath}&$skip=${all.length}`;
  } else {
    next = null;
  }
}
const fetchMs = Date.now() - t0;
console.log(`✅ ${all.length} articles téléchargés en ${(fetchMs/1000).toFixed(1)}s\n`);

// Filter analysis
const valid = all.filter(it => it.Valid !== "tNO" && it.Frozen !== "tYES");
const invalid = all.length - valid.length;
const packaging = valid.filter(it => PACKAGING_GROUPS.has(it.ItemsGroupCode) || NOISE_GROUPS.has(it.ItemsGroupCode));
const productsForSale = valid.filter(it => !PACKAGING_GROUPS.has(it.ItemsGroupCode) && !NOISE_GROUPS.has(it.ItemsGroupCode));
const withStock = productsForSale.filter(it => (it.QuantityOnStock ?? 0) > 0);

console.log("📊 Analyse du filtrage :");
console.log(`   ${all.length} articles totaux`);
console.log(`   - ${invalid} invalides/frozen exclus`);
console.log(`   - ${packaging.length} tagués 'emballage' (groupe 114 ou noise) → cachés par défaut`);
console.log(`   = ${productsForSale.length} produits 'vendables' affichés`);
console.log(`   dont ${withStock.length} avec stock > 0\n`);

// Sample top 10 avec stock
console.log("🔥 Top 10 avec le plus de stock global :");
[...withStock].sort((a, b) => (b.QuantityOnStock ?? 0) - (a.QuantityOnStock ?? 0)).slice(0, 10).forEach(it => {
  const g = groupMap.get(it.ItemsGroupCode) || "?";
  console.log(`   • ${it.ItemCode.padEnd(20)} | ${it.ItemName.padEnd(35)} | stock=${(it.QuantityOnStock).toFixed(2).padStart(12)} ${it.SalesUnit || ''} | ${g}`);
});

// Warehouse coverage
console.log("\n🏬 Couverture entrepôts 000/01/R1 :");
const whCount = { "000": 0, "01": 0, "R1": 0 };
let totalRelevantWh = 0;
for (const it of withStock) {
  for (const w of it.ItemWarehouseInfoCollection || []) {
    if (WAREHOUSES.has(w.WarehouseCode)) {
      totalRelevantWh++;
      if ((w.InStock ?? 0) > 0) whCount[w.WarehouseCode]++;
    }
  }
}
Object.entries(whCount).forEach(([k, v]) => console.log(`   ${k} : ${v} produits avec stock > 0`));

await req("POST", "Logout", { cookies });
console.log("\n✅ Dry-run terminé. La vraie sync écrira en DB tout ça.");
