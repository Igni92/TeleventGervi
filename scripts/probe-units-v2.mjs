/** Probe SAP B1 — units fields + batch→price link */
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

// ── 1. Get ALL fields of one Item to find unit-related ones ──
console.log("\n== 1. Article FRAMB12P — TOUS les champs ==");
const fullItem = await req("GET", "Items('FRAMB12P')", { cookies });
if (fullItem.status === 200) {
  const it = fullItem.body;
  // Filter to keep only unit/UoM-related fields
  const unitKeys = Object.keys(it).filter(k =>
    /unit|UoM|UOM|num.*in|quantity|weight|packag|sale|purchase|inventor|barcode/i.test(k)
    && it[k] !== null && it[k] !== "" && it[k] !== 0
  );
  unitKeys.forEach(k => console.log(`   ${k.padEnd(30)} : ${JSON.stringify(it[k])}`));
} else {
  console.log("Error:", fullItem.body);
}

// ── 2. UnitOfMeasurementGroups ─────────────────────────────
console.log("\n== 2. UoMGroups (top 3) ==");
const uomGroups = await req("GET", "UnitOfMeasurementGroups?$top=3", { cookies });
if (uomGroups.status === 200 && uomGroups.body.value?.[0]) {
  console.log("Keys:", Object.keys(uomGroups.body.value[0]).join(", "));
  console.log("Sample:", JSON.stringify(uomGroups.body.value[0], null, 2));
} else {
  console.log("Error:", uomGroups.body);
}

// ── 3. UnitOfMeasurements list ────────────────────────────
console.log("\n== 3. UnitOfMeasurements (top 10) ==");
const uoms = await req("GET", "UnitOfMeasurements?$top=10&$select=AbsEntry,Code,Name", { cookies });
if (uoms.status === 200) {
  (uoms.body.value || []).forEach(u => console.log(`   ${u.AbsEntry} | ${u.Code} | ${u.Name}`));
} else {
  console.log("Error:", uoms.body);
}

// ── 4. Find a batch with a SystemNumber, then look it up via JE/IL ──
console.log("\n== 4. Try linking a batch to its purchase price ==");
const batch = await req("GET", "BatchNumberDetails?$top=1&$orderby=SystemNumber desc", { cookies });
if (batch.body.value?.[0]) {
  const b = batch.body.value[0];
  console.log(`Lot ${b.Batch} | ItemCode ${b.ItemCode} | SystemNumber ${b.SystemNumber} | DocEntry ${b.DocEntry}`);

  // SAP B1 OINM (Inventory Transactions) — try via SQL query
  console.log("\nTry InventoryGenEntries with this item:");
  const ige = await req("GET", `InventoryGenEntries?$top=1&$filter=DocumentLines/any(l: l/ItemCode eq '${b.ItemCode}')`, { cookies });
  console.log("  Status:", ige.status, ige.status !== 200 ? ige.body?.error?.message?.value : "OK");

  // Try BatchNumbers — different endpoint
  console.log("\nTry BatchNumbers endpoint:");
  const bn = await req("GET", `BatchNumbers?$top=2`, { cookies });
  if (bn.status === 200 && bn.body.value?.[0]) {
    console.log("  Keys:", Object.keys(bn.body.value[0]).join(", "));
    console.log("  Sample:", JSON.stringify(bn.body.value[0], null, 2));
  } else {
    console.log("  Status:", bn.status, bn.body?.error?.message?.value);
  }
}

// ── 5. Try SQL query endpoint ──────────────────────────────
console.log("\n== 5. SQLQueries endpoint disponible ? ==");
const sql = await req("GET", "SQLQueries", { cookies });
console.log("Status:", sql.status, sql.status === 200 ? `(${sql.body.value?.length || 0} queries)` : sql.body?.error?.message?.value);

await req("POST", "Logout", { cookies });
