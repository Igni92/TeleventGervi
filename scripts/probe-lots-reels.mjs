/** Où vit le vrai numéro de lot ? Items batch-managed, BatchNumberDetails, stock par lot. */
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

// 1. Combien d'items sont batch-managed ?
console.log("=== Items batch-managed (ManageBatchNumbers eq 'tYES') ===");
const bm = await req("GET", "Items?$filter=ManageBatchNumbers eq 'tYES' and Valid eq 'tYES'&$top=10&$select=ItemCode,ItemName,ManageBatchNumbers,QuantityOnStock", { cookies });
console.log("Status", bm.status, "count:", bm.body?.value?.length);
for (const it of (bm.body?.value || [])) console.log(`  ${it.ItemCode} | ${it.ItemName} | stock=${it.QuantityOnStock}`);
const sampleBatchItem = bm.body?.value?.find(i => i.QuantityOnStock > 0)?.ItemCode || bm.body?.value?.[0]?.ItemCode;

// 2. Total items batch vs non-batch
const allBatch = await req("GET", "Items/$count?$filter=ManageBatchNumbers eq 'tYES'", { cookies });
const allItems = await req("GET", "Items/$count?$filter=Valid eq 'tYES'", { cookies });
console.log(`\nTotal batch-managed: ${JSON.stringify(allBatch.body)} / total valid: ${JSON.stringify(allItems.body)}`);

// 3. Pour un item batch-managé, voir ses lots
if (sampleBatchItem) {
  console.log(`\n=== BatchNumberDetails pour ${sampleBatchItem} ===`);
  const bd = await req("GET", `BatchNumberDetails?$filter=ItemCode eq '${sampleBatchItem}'&$orderby=ExpirationDate asc&$top=10`, { cookies });
  console.log("Status", bd.status, "count", bd.body?.value?.length);
  if (bd.body?.value?.[0]) console.log("Keys:", Object.keys(bd.body.value[0]).join(", "));
  for (const b of (bd.body?.value || [])) console.log(`  Batch=${b.Batch} Status=${b.Status} Exp=${b.ExpirationDate} Sys=${b.SystemNumber}`);
}

// 4. Comment SAP relie un lot à un BL ? Regarder les lignes d'un BL récent qui a U_NoLot != EM0000
console.log("\n=== Orders récents : distribution des U_NoLot (≠ EM0000 ?) ===");
const orders = await req("GET", "Orders?$top=80&$orderby=DocEntry desc", { cookies });
const lotCounts = {};
for (const o of (orders.body?.value || [])) {
  for (const l of (o.DocumentLines || [])) {
    const lot = l.U_NoLot || "(vide)";
    lotCounts[lot] = (lotCounts[lot] || 0) + 1;
  }
}
console.log(JSON.stringify(lotCounts, null, 2));

// 5. Un order avec U_NoLot réel (pas EM0000) ? montrer l'item + lot
console.log("\n=== Lignes avec U_NoLot réel (≠ EM0000/vide) ===");
let shown = 0;
for (const o of (orders.body?.value || [])) {
  for (const l of (o.DocumentLines || [])) {
    if (l.U_NoLot && l.U_NoLot !== "EM0000" && shown < 15) {
      console.log(`  Order #${o.DocNum} | ${l.ItemCode} | U_NoLot=${l.U_NoLot} | Whs=${l.WarehouseCode}`);
      shown++;
    }
  }
}
if (shown === 0) console.log("  Aucune — tous les orders récents utilisent EM0000 ou vide.");

await req("POST", "Logout", { cookies });
