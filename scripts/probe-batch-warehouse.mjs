/** Comprendre comment SAP expose lots × entrepôt × quantité pour un article. */
import https from "node:https"; import fs from "node:fs"; import { URL } from "node:url";
function loadEnv(p) {
  if (!fs.existsSync(p)) return;
  for (const line of fs.readFileSync(p, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (m && !process.env[m[1]]) { let v = m[2].trim();
      if ((v.startsWith('"') && v.endsWith('"'))) v = v.slice(1, -1);
      v = v.replace(/\\\$/g, "$"); process.env[m[1]] = v; }
  }
}
loadEnv(".env.local");
function req(method, path, opts = {}) {
  return new Promise((res, rej) => {
    const t = new URL(path, process.env.SAP_B1_BASE_URL + "/");
    const r = https.request({ hostname: t.hostname, port: t.port || 443, path: t.pathname + t.search, method,
      rejectUnauthorized: false, headers: { "Content-Type": "application/json", ...(opts.cookies ? { Cookie: opts.cookies } : {}) } },
      (resp) => { let d = ""; resp.on("data", c => d += c); resp.on("end", () => { let p = d; try { p = JSON.parse(d); } catch {}; res({ status: resp.statusCode, body: p, headers: resp.headers }); }); });
    r.on("error", rej); if (opts.body) r.write(JSON.stringify(opts.body)); r.end();
  });
}
const login = await req("POST", "Login", { body: { CompanyDB: process.env.SAP_B1_COMPANY_DB, UserName: process.env.SAP_B1_USERNAME, Password: process.env.SAP_B1_PASSWORD } });
const cookies = (login.headers["set-cookie"] || []).map(c => c.split(";")[0]).join("; ");

const ITEM = process.argv[2] || "FRAMB12PD";

// 1. Per-warehouse stock
console.log(`=== Item ${ITEM} — ItemWarehouseInfoCollection ===`);
const it = await req("GET", `Items('${ITEM}')?$select=ItemCode,ManageBatchNumbers,QuantityOnStock,ItemWarehouseInfoCollection`, { cookies });
if (it.status === 200) {
  console.log("ManageBatch:", it.body.ManageBatchNumbers, "TotalStock:", it.body.QuantityOnStock);
  for (const w of (it.body.ItemWarehouseInfoCollection || [])) {
    if (["000","01","R1"].includes(w.WarehouseCode))
      console.log(`  Whs ${w.WarehouseCode}: InStock=${w.InStock} Committed=${w.Committed} Ordered=${w.Ordered}`);
  }
}

// 2. BatchNumberDetails — fields
console.log(`\n=== BatchNumberDetails(${ITEM}) ===`);
const bd = await req("GET", `BatchNumberDetails?$filter=ItemCode eq '${ITEM}'&$top=5`, { cookies });
if (bd.status === 200 && bd.body?.value?.[0]) {
  console.log("Keys:", Object.keys(bd.body.value[0]).join(", "));
  bd.body.value.forEach(b => console.log(`  Batch=${b.Batch} Status=${b.Status} Exp=${b.ExpirationDate} Sys=${b.SystemNumber}`));
} else { console.log("status", bd.status, "len", bd.body?.value?.length); }

// 3. Essayer endpoint quantité lot/entrepôt
for (const ep of [
  `SerialNumberDetails?$filter=ItemCode eq '${ITEM}'&$top=3`,
  `BatchNumberDetails?$filter=ItemCode eq '${ITEM}'&$expand=BatchNumberDetailsParams&$top=2`,
  `Items('${ITEM}')/ItemWarehouseInfoCollection`,
]) {
  console.log(`\n=== ${ep.slice(0,60)} ===`);
  const r = await req("GET", ep, { cookies });
  console.log("status", r.status);
  if (r.status === 200) console.log(JSON.stringify(r.body).slice(0, 400));
  else console.log(r.body?.error?.message?.value || "");
}

// 4. The real source: BatchNumberDetails doesn't have per-whs qty.
//    Try the inventory "BatchNumbers" via a DeliveryNotes-style draft? No.
//    Check if there's a "Batch on hand" query semantic layer.
console.log("\n=== sml.svc / semantic? skip. Test InventoryCountings? ===");

await req("POST", "Logout", { cookies });
