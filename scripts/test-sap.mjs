/**
 * Test SAP B1 Service Layer connection (zero deps).
 *   node scripts/test-sap.mjs
 */

import https from "node:https";
import fs from "node:fs";
import { URL } from "node:url";

// Manual .env.local loader
function loadEnv(path) {
  if (!fs.existsSync(path)) return;
  for (const line of fs.readFileSync(path, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
  }
}
loadEnv(".env.local");

const BASE = process.env.SAP_B1_BASE_URL;
const COMPANY = process.env.SAP_B1_COMPANY_DB;
const USER = process.env.SAP_B1_USERNAME;
const PASS = process.env.SAP_B1_PASSWORD;
const INSECURE = process.env.SAP_B1_TLS_INSECURE === "1";

if (!BASE || !COMPANY || !USER || !PASS) {
  console.error("❌ Missing SAP env vars. Check .env.local");
  process.exit(1);
}

const baseUrl = new URL(BASE);

/** Raw HTTPS request returning { status, headers, body (parsed JSON or string) } */
function request(method, path, { headers = {}, body = null, cookies = "" } = {}) {
  return new Promise((resolve, reject) => {
    const target = new URL(path, BASE.endsWith("/") ? BASE : BASE + "/");
    const opts = {
      hostname: target.hostname,
      port: target.port || 443,
      path: target.pathname + target.search,
      method,
      rejectUnauthorized: !INSECURE,
      headers: {
        "Content-Type": "application/json",
        "Accept": "application/json",
        ...(cookies ? { Cookie: cookies } : {}),
        ...headers,
      },
    };
    const req = https.request(opts, (res) => {
      let data = "";
      res.on("data", (c) => (data += c));
      res.on("end", () => {
        let parsed = data;
        if (res.headers["content-type"]?.includes("application/json")) {
          try { parsed = JSON.parse(data); } catch { /* keep string */ }
        }
        resolve({ status: res.statusCode, headers: res.headers, body: parsed });
      });
    });
    req.on("error", reject);
    if (body) req.write(typeof body === "string" ? body : JSON.stringify(body));
    req.end();
  });
}

console.log("🔌 SAP B1 Service Layer test");
console.log("   URL:", BASE);
console.log("   Company:", COMPANY);
console.log("   User:", USER);
console.log("   TLS verify:", INSECURE ? "DISABLED (dev)" : "enabled");
console.log();

// ── 1. Login ───────────────────────────────────────────────
console.log("[1/4] POST /Login …");
let loginRes;
try {
  loginRes = await request("POST", "Login", {
    body: { CompanyDB: COMPANY, UserName: USER, Password: PASS },
  });
} catch (e) {
  console.error("💥 Erreur réseau:", e.code || e.message);
  if (e.code === "ETIMEDOUT" || e.code === "ENETUNREACH") {
    console.error("   → L'IP", baseUrl.hostname, "est injoignable depuis cette machine.");
    console.error("   → Vérifier firewall / VPN / IP whitelist côté SAP");
  }
  if (e.code === "DEPTH_ZERO_SELF_SIGNED_CERT" || e.code === "SELF_SIGNED_CERT_IN_CHAIN") {
    console.error("   → Cert auto-signé rejeté. SAP_B1_TLS_INSECURE=1 devrait l'autoriser.");
  }
  process.exit(2);
}

if (loginRes.status !== 200) {
  console.error("❌ Login HTTP", loginRes.status);
  console.error("   Body:", typeof loginRes.body === "string" ? loginRes.body.slice(0, 500) : JSON.stringify(loginRes.body, null, 2));
  process.exit(3);
}

const rawCookies = loginRes.headers["set-cookie"];
const cookieHeader = Array.isArray(rawCookies)
  ? rawCookies.map((c) => c.split(";")[0]).join("; ")
  : "";
console.log("✅ Login OK");
console.log("   Version:", loginRes.body?.Version || "n/a");
console.log("   SessionId:", loginRes.body?.SessionId);
console.log("   SessionTimeout:", loginRes.body?.SessionTimeout, "min");
console.log();

// ── 2. Items (sample) ──────────────────────────────────────
console.log("[2/4] GET /Items?$top=3 …");
const itemsRes = await request(
  "GET",
  "Items?$top=3&$select=ItemCode,ItemName,QuantityOnStock,ItemsGroupCode,InventoryItem,SalesItem,ManageBatchNumbers",
  { cookies: cookieHeader },
);
if (itemsRes.status !== 200) {
  console.error("❌ Items query:", itemsRes.status);
  console.error("   Body:", JSON.stringify(itemsRes.body, null, 2));
  process.exit(4);
}
const items = itemsRes.body.value ?? [];
console.log(`✅ ${items.length} articles récupérés (échantillon)`);
items.forEach((it) => {
  console.log(`   • ${it.ItemCode} | ${it.ItemName} | stock global: ${it.QuantityOnStock} | batch: ${it.ManageBatchNumbers}`);
});
console.log();

// Pick first batch-managed item if any, else first item
const target = items.find((it) => it.ManageBatchNumbers === "tYES") || items[0];
if (!target) { console.log("⚠️  No items"); process.exit(0); }

// ── 3. Per-warehouse stock ─────────────────────────────────
console.log(`[3/4] GET /Items('${target.ItemCode}')?$select=ItemWarehouseInfoCollection …`);
const stockRes = await request(
  "GET",
  `Items('${encodeURIComponent(target.ItemCode)}')?$select=ItemCode,ItemName,ItemWarehouseInfoCollection,ManageBatchNumbers`,
  { cookies: cookieHeader },
);
if (stockRes.status !== 200) {
  console.error("⚠️  Stock query:", stockRes.status, stockRes.body);
} else {
  const whs = stockRes.body.ItemWarehouseInfoCollection ?? [];
  console.log(`✅ ${whs.length} entrepôt(s) pour ${target.ItemCode}`);
  whs.slice(0, 8).forEach((w) => {
    console.log(`   • ${w.WarehouseCode} | in: ${w.InStock} | committed: ${w.Committed} | ordered: ${w.Ordered} | dispo: ${(w.InStock ?? 0) - (w.Committed ?? 0)}`);
  });
}
console.log();

// ── 4. Batches ─────────────────────────────────────────────
if (target.ManageBatchNumbers === "tYES") {
  console.log(`[4/4] GET /BatchNumberDetails?$filter=ItemCode eq '${target.ItemCode}'&$top=5 …`);
  const batchRes = await request(
    "GET",
    `BatchNumberDetails?$filter=ItemCode eq '${target.ItemCode}'&$top=5&$select=ItemCode,Batch,ExpirationDate,Status,SystemNumber`,
    { cookies: cookieHeader },
  );
  if (batchRes.status === 200) {
    console.log(`✅ ${batchRes.body.value?.length ?? 0} lot(s)`);
    (batchRes.body.value ?? []).forEach((b) => {
      console.log(`   • Lot ${b.Batch} | exp: ${b.ExpirationDate} | statut: ${b.Status}`);
    });
  } else {
    console.log("⚠️  Batch query:", batchRes.status, batchRes.body);
  }
} else {
  console.log("[4/4] Skipped — article non géré en lots");
}

// ── Logout ─────────────────────────────────────────────────
await request("POST", "Logout", { cookies: cookieHeader });
console.log("\n🔚 Session fermée proprement.");
