/** Vérifie : U_NoLot = "EM" + DocNum du dernier PurchaseDeliveryNote contenant l'article. */
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

// Observé : FE1SL→EM22739, FRAMB12PD→EM22752, MURE1PD→EM22751
const expected = { FE1SL: "EM22739", FRAMB12PD: "EM22752", MURE1PD: "EM22751" };

// Scan client-side : pour chaque item, le PLUS GRAND DocNum de PDN qui le contient,
// et aussi le plus grand DocNum par (item, warehouse).
const lastByItem = {};        // item -> maxDocNum
const lastByItemWhs = {};     // item|whs -> maxDocNum
let skip = 0, scanned = 0;
while (skip < 600) {
  const r = await req("GET", `PurchaseDeliveryNotes?$top=50&$skip=${skip}&$orderby=DocNum desc&$select=DocNum,DocDate,DocumentLines`, { cookies });
  const items = r.body?.value || [];
  if (items.length === 0) break;
  for (const d of items) {
    for (const l of (d.DocumentLines || [])) {
      if (!lastByItem[l.ItemCode] || d.DocNum > lastByItem[l.ItemCode]) lastByItem[l.ItemCode] = d.DocNum;
      const key = `${l.ItemCode}|${l.WarehouseCode}`;
      if (!lastByItemWhs[key] || d.DocNum > lastByItemWhs[key]) lastByItemWhs[key] = d.DocNum;
    }
  }
  skip += items.length; scanned += items.length;
  // Arrête dès qu'on a les 3 items attendus
  if (Object.keys(expected).every(it => lastByItem[it])) break;
}
console.log(`(${scanned} réceptions scannées)\n`);
for (const [item, exp] of Object.entries(expected)) {
  const computed = lastByItem[item] ? `EM${lastByItem[item]}` : "(aucune)";
  const match = computed === exp ? "✅" : `❌ attendu ${exp}`;
  console.log(`${item.padEnd(12)} → dernier PDN global: ${computed.padEnd(10)} ${match}`);
  // Détail par entrepôt
  const whsKeys = Object.keys(lastByItemWhs).filter(k => k.startsWith(item + "|"));
  for (const k of whsKeys) console.log(`      ${k.split("|")[1]} → EM${lastByItemWhs[k]}`);
}

// Variante : filtrer par entrepôt de réception ?
console.log("\n=== PDN FE1SL : entrepôts de réception des dernières entrées ===");
const multi = await req("GET",
  `PurchaseDeliveryNotes?$top=5&$orderby=DocNum desc&$filter=DocumentLines/any(l: l/ItemCode eq 'FE1SL')&$select=DocNum,DocDate,DocumentLines`,
  { cookies });
for (const d of (multi.body?.value || [])) {
  const whs = [...new Set((d.DocumentLines||[]).filter(l=>l.ItemCode==="FE1SL").map(l=>l.WarehouseCode))];
  console.log(`  EM${d.DocNum} (${d.DocDate?.slice(0,10)}) → entrepôts: ${whs.join(", ")}`);
}

await req("POST", "Logout", { cookies });
