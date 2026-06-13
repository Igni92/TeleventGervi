/** Test BL creation directly against SAP — minimal payload, verbose error reporting. */
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

console.log("DB:", process.env.SAP_B1_COMPANY_DB);
console.log("URL:", BASE);

const login = await req("POST", "Login", {
  body: { CompanyDB: process.env.SAP_B1_COMPANY_DB, UserName: process.env.SAP_B1_USERNAME, Password: process.env.SAP_B1_PASSWORD },
});
console.log("Login:", login.status, login.status === 200 ? "OK" : login.body);
if (login.status !== 200) process.exit(1);
const cookies = (login.headers["set-cookie"] || []).map(c => c.split(";")[0]).join("; ");

// 1. Pick a real client + item with stock to make a valid BL
console.log("\n== Pick valid customer + item ==");
const cust = await req("GET", "BusinessPartners?$filter=CardType eq 'cCustomer' and Valid eq 'tYES'&$top=1&$select=CardCode,CardName", { cookies });
const cardCode = cust.body.value?.[0]?.CardCode;
console.log("Customer:", cardCode, "|", cust.body.value?.[0]?.CardName);

const it = await req("GET", "Items?$filter=Valid eq 'tYES' and QuantityOnStock gt 0&$top=1&$select=ItemCode,ItemName,QuantityOnStock,ItemWarehouseInfoCollection", { cookies });
const item = it.body.value?.[0];
if (!item) { console.log("⚠️ No item with stock found"); process.exit(2); }
const wh = (item.ItemWarehouseInfoCollection || []).find(w => (w.InStock ?? 0) > 0);
console.log("Item:", item.ItemCode, "|", item.ItemName, "| stock:", item.QuantityOnStock, "| wh:", wh?.WarehouseCode);

// 2. Try MINIMAL payload first
console.log("\n== Test 1 : payload minimal ==");
const today = new Date().toISOString().slice(0, 10);
const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
const minimal = {
  CardCode: cardCode,
  DocDate: today,
  DocDueDate: tomorrow,
  DocumentLines: [
    { ItemCode: item.ItemCode, Quantity: 1, WarehouseCode: wh?.WarehouseCode || "01" },
  ],
};
console.log("Payload:", JSON.stringify(minimal, null, 2));

const r1 = await req("POST", "DeliveryNotes", { cookies, body: minimal });
console.log("Status:", r1.status);
if (r1.status >= 400) {
  console.log("Error:", JSON.stringify(r1.body, null, 2));
} else {
  console.log("✅ Created! DocNum:", r1.body?.DocNum, "| DocEntry:", r1.body?.DocEntry);
}

// ── Test 2 : payload exact de l'endpoint /api/sap/delivery-notes ──
console.log("\n== Test 2 : payload exact du endpoint TeleVent ==");
const full = {
  CardCode: cardCode,
  DocDate: today,
  DocDueDate: tomorrow,
  TaxDate: today,
  Comments: "Commande téléphone via TeleVent — Test direct script",
  DocumentLines: [
    { ItemCode: item.ItemCode, Quantity: 1, WarehouseCode: wh?.WarehouseCode || "01" },
  ],
};
console.log("Payload:", JSON.stringify(full, null, 2));

const r2 = await req("POST", "DeliveryNotes", { cookies, body: full });
console.log("Status:", r2.status);
if (r2.status >= 400) {
  console.log("❌ Error:", JSON.stringify(r2.body, null, 2));
} else {
  console.log("✅ Created! DocNum:", r2.body?.DocNum, "| DocEntry:", r2.body?.DocEntry);
}

await req("POST", "Logout", { cookies });
