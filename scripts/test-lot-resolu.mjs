/** Reproduit resolveLot() et crée une commande pour vérifier les U_NoLot. */
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

// Build lot maps (idem getLotMaps)
const byItemWhs = new Map(), byItem = new Map();
let skip = 0;
while (skip < 500) {
  const r = await req("GET", `PurchaseDeliveryNotes?$top=50&$skip=${skip}&$orderby=DocNum desc&$select=DocNum,DocumentLines`, { cookies });
  const docs = r.body?.value || [];
  if (docs.length === 0) break;
  for (const d of docs) for (const l of (d.DocumentLines || [])) {
    if (!l.ItemCode) continue;
    if (!byItem.has(l.ItemCode) || d.DocNum > byItem.get(l.ItemCode)) byItem.set(l.ItemCode, d.DocNum);
    if (l.WarehouseCode) { const k = `${l.ItemCode}|${l.WarehouseCode}`; if (!byItemWhs.has(k) || d.DocNum > byItemWhs.get(k)) byItemWhs.set(k, d.DocNum); }
  }
  skip += docs.length;
}
const resolveLot = (item, whs) => {
  if (whs && byItemWhs.has(`${item}|${whs}`)) return `EM${byItemWhs.get(`${item}|${whs}`)}`;
  if (byItem.has(item)) return `EM${byItem.get(item)}`;
  return "EM0000";
};

const tests = [["FE1SL","000"],["FRAMB12PD","01"],["FRAMB12PD","000"],["MURE1PD","000"]];
console.log("=== Lots résolus ===");
for (const [it, w] of tests) console.log(`  ${it}@${w} → ${resolveLot(it, w)}`);

// Crée une commande de test
const lines = [
  { ItemCode: "FE1SL", Quantity: 10, Price: 5.8, WarehouseCode: "000", U_NoLot: resolveLot("FE1SL","000") },
  { ItemCode: "FRAMB12PD", Quantity: 12, Price: 2.3, WarehouseCode: "01", U_NoLot: resolveLot("FRAMB12PD","01") },
  { ItemCode: "FRAMB12PD", Quantity: 12, Price: 2.3, WarehouseCode: "000", U_NoLot: resolveLot("FRAMB12PD","000") },
];
const r = await req("POST", "Orders", { cookies, body: { CardCode: "AAUXERRE", DocDueDate: "2026-06-03", Comments: "TEST lots résolus — à supprimer", DocumentLines: lines } });
console.log("\n=== Commande créée ===", "status", r.status);
if (r.status >= 200 && r.status < 300) {
  const e = await req("GET", `Orders(${r.body.DocEntry})`, { cookies });
  for (const l of e.body.DocumentLines)
    console.log(`  ${l.ItemCode}@${l.WarehouseCode} → U_NoLot=${l.U_NoLot}`);
} else console.error("❌", JSON.stringify(r.body).slice(0, 500));
await req("POST", "Logout", { cookies });
