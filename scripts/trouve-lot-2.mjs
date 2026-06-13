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

// 1. TOUTES les UDT, filtrées sur mots-clés lot
console.log("=== UDT contenant lot/stock/ger/ligne ===");
let skip = 0;
const allTables = [];
while (skip < 500) {
  const r = await req("GET", `UserTablesMD?$top=100&$skip=${skip}&$select=TableName,TableDescription`, { cookies });
  const items = r.body?.value || [];
  if (items.length === 0) break;
  allTables.push(...items);
  skip += items.length;
}
console.log(`Total UDT: ${allTables.length}`);
for (const t of allTables) {
  if (/lot|trac|ger|march|reception|entree|batch/i.test(t.TableName + " " + t.TableDescription))
    console.log(`  @${t.TableName} — ${t.TableDescription}`);
}

// 2. Goods receipt : PurchaseDeliveryNotes existe-t-il ? Et InventoryGenEntries ?
console.log("\n=== Test entités réception ===");
for (const ep of ["PurchaseDeliveryNotes?$top=1", "InventoryGenEntries?$top=1", "InventoryGenExits?$top=1", "PurchaseReturns?$top=1"]) {
  const r = await req("GET", ep, { cookies });
  console.log(`  ${ep.split("?")[0]} → ${r.status} ${r.status===200?"(OK)":""}`);
}

// 3. Y a-t-il un goods receipt avec DocNum 22739 ? (EM22739)
console.log("\n=== Recherche DocNum 22739 dans réceptions ===");
for (const ep of ["PurchaseDeliveryNotes", "InventoryGenEntries"]) {
  const r = await req("GET", `${ep}?$filter=DocNum eq 22739&$top=2`, { cookies });
  console.log(`  ${ep} DocNum 22739 → ${r.status}, trouvé: ${r.body?.value?.length || 0}`);
  if (r.body?.value?.[0]) {
    const d = r.body.value[0];
    console.log(`    Date=${d.DocDate} Lignes items: ${(d.DocumentLines||[]).map(l=>l.ItemCode).slice(0,6).join(", ")}`);
  }
}

// 4. Le champ U_NoLot existe-t-il sur les lignes de réception ? Regarder une réception récente de FE1SL
console.log("\n=== Dernières InventoryGenEntries avec FE1SL ===");
const ige = await req("GET", "InventoryGenEntries?$top=20&$orderby=DocEntry desc", { cookies });
let found = 0;
for (const d of (ige.body?.value || [])) {
  for (const l of (d.DocumentLines || [])) {
    if (l.ItemCode === "FE1SL" && found < 3) {
      found++;
      const us = Object.entries(l).filter(([k,v]) => k.startsWith("U_") && v && v !== "");
      console.log(`  IGE #${d.DocNum} ligne FE1SL Whs=${l.WarehouseCode} Qty=${l.Quantity}: ${us.map(([k,v])=>`${k}=${v}`).join(", ") || "(aucun U_*)"}`);
    }
  }
}
if (found === 0) console.log("  Aucune IGE FE1SL récente.");

await req("POST", "Logout", { cookies });
