/** Vérifie que les items FRAMB12PD et FE5B existent en SAP TEST + stock dispo. */
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
console.log("DB:", process.env.SAP_B1_COMPANY_DB);

// Check ABOUL customer
console.log("\n== Client ABOUL ==");
const cust = await req("GET", "BusinessPartners('ABOUL')?$select=CardCode,CardName,Valid,Frozen", { cookies });
console.log("Status:", cust.status, "→", cust.status === 200 ? `${cust.body.CardName} (valid=${cust.body.Valid})` : cust.body?.error?.message?.value);

// Check items
for (const code of ["FRAMB12PD", "FE5B"]) {
  console.log(`\n== Item ${code} ==`);
  const it = await req("GET", `Items('${code}')?$select=ItemCode,ItemName,Valid,Frozen,QuantityOnStock,ItemWarehouseInfoCollection`, { cookies });
  if (it.status === 200) {
    console.log(`  ItemName: ${it.body.ItemName} | Valid: ${it.body.Valid} | Frozen: ${it.body.Frozen} | stock global: ${it.body.QuantityOnStock}`);
    console.log("  Entrepôts:");
    (it.body.ItemWarehouseInfoCollection || []).filter(w => ["000", "01", "R1"].includes(w.WarehouseCode)).forEach(w => {
      console.log(`    ${w.WarehouseCode} | inStock=${w.InStock} | committed=${w.Committed}`);
    });
  } else {
    console.log("  ❌", it.status, it.body?.error?.message?.value);
  }
}

// Try to POST the exact order to see what fails
console.log("\n== Test création ordre complet ==");
const today = new Date().toISOString().slice(0, 10);
const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
const payload = {
  CardCode: "ABOUL",
  DocDate: today, DocDueDate: tomorrow,
  Comments: "Test diag",
  DocumentLines: [
    { ItemCode: "FRAMB12PD", Quantity: 8 * 12, WarehouseCode: "01", Price: 2.6 / 12 },
    { ItemCode: "FE5B", Quantity: 10, WarehouseCode: "000", Price: 6.60 },
  ],
};
console.log("Payload:", JSON.stringify(payload, null, 2));
const r = await req("POST", "Orders", { cookies, body: payload });
console.log(`Status: ${r.status}`);
if (r.status >= 400) {
  console.log("Error full:", JSON.stringify(r.body, null, 2));
} else {
  console.log("✅ DocNum:", r.body?.DocNum);
}

await req("POST", "Logout", { cookies });
