/** Probe /Orders structure on GERVIFRAIS_TEST. */
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
console.log("DB:", process.env.SAP_B1_COMPANY_DB, "→ Login:", login.status);
if (login.status !== 200) process.exit(1);
const cookies = (login.headers["set-cookie"] || []).map(c => c.split(";")[0]).join("; ");

// 1. Get a recent Order (Commande client)
console.log("\n== 1. Dernière Commande Client (Order) ==");
const o = await req("GET", "Orders?$top=1&$orderby=DocEntry desc", { cookies });
if (o.body.value?.[0]) {
  const doc = o.body.value[0];
  const keys = [
    "DocEntry","DocNum","DocType","DocDate","DocDueDate","CardCode","CardName",
    "Series","SalesPersonCode","Comments","JournalMemo","NumAtCard",
    "DocCurrency","DocTotal","TaxDate","TransportationCode",
    "Address","Address2","ShipToCode","PayToCode",
  ];
  keys.forEach(k => {
    if (doc[k] != null && doc[k] !== "" && doc[k] !== 0) {
      console.log(`  ${k.padEnd(28)} : ${JSON.stringify(doc[k])}`);
    }
  });
  console.log("\n  --- Document Line[0] ---");
  const line = doc.DocumentLines?.[0];
  if (line) {
    ["LineNum","ItemCode","ItemDescription","Quantity","Price","WarehouseCode","SalesPersonCode","VatGroup","Currency","UoMEntry","UoMCode","LineTotal"].forEach(k => {
      if (line[k] != null && line[k] !== "" && line[k] !== 0) {
        console.log(`  ${k.padEnd(28)} : ${JSON.stringify(line[k])}`);
      }
    });
  }
}

// 2. Test create a minimal Order
console.log("\n== 2. Test création Order minimal ==");
// Force a known customer for the test
const cardCode = "AAUXERRE";
console.log("Customer:", cardCode);
const it = await req("GET", "Items?$filter=Valid eq 'tYES' and QuantityOnStock gt 0&$top=1&$select=ItemCode,ItemName,ItemWarehouseInfoCollection", { cookies });
const item = it.body.value?.[0];
const wh = (item.ItemWarehouseInfoCollection || []).find(w => (w.InStock ?? 0) > 0);

const today = new Date().toISOString().slice(0, 10);
const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
const payload = {
  CardCode: cardCode,
  DocDate: today,
  DocDueDate: tomorrow,
  Comments: "Test création Commande via API TeleVent",
  DocumentLines: [
    { ItemCode: item.ItemCode, Quantity: 1, WarehouseCode: wh?.WarehouseCode || "01" },
  ],
};
console.log("Payload:", JSON.stringify(payload, null, 2));

const r = await req("POST", "Orders", { cookies, body: payload });
console.log("Status:", r.status);
if (r.status >= 400) {
  console.log("❌ Error:", JSON.stringify(r.body, null, 2));
} else {
  console.log("✅ Commande créée — DocNum:", r.body.DocNum, "| DocEntry:", r.body.DocEntry);
}

await req("POST", "Logout", { cookies });
