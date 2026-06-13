/**
 * Diag propagation rétro fabrication (LECTURE SEULE).
 *
 *   node scripts/diag-retro-fabrication.mjs [YYYY-MM-DD]
 *
 * Valide la requête utilisée par /api/sap/goods-receipts pour étendre la
 * propagation rétro aux InventoryGenExits :
 *
 * 1. InventoryGenExits du jour — $filter DocDate quoté, DocumentLines dans le
 *    $select (pas de $expand sur cette base), $orderby DocEntry asc.
 *    → HTTP attendu 200 + lignes avec LineNum/ItemCode/Quantity/U_NoLot.
 * 2. Scan des 200 dernières sorties : combien de lignes portent encore le
 *    sentinel EM_PENDING (candidates à la propagation) ?
 *
 * Plumbing identique à scripts/diag-carriers.mjs (parsing .env + déséchappement \$).
 */
import fs from "node:fs";
import https from "node:https";
import path from "node:path";

const env = {};
for (const f of [".env", ".env.local"]) {
  const p = path.resolve(process.cwd(), f);
  if (!fs.existsSync(p)) continue;
  for (const line of fs.readFileSync(p, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([\w.]+)\s*=\s*(.*)\s*$/); if (!m) continue;
    let v = m[2].trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    env[m[1]] = v.replace(/\\\$/g, "$");
  }
}
const g = (k) => process.env[k] ?? env[k] ?? "";
const BASE = g("SAP_B1_BASE_URL");
const agent = new https.Agent({ rejectUnauthorized: g("SAP_B1_TLS_INSECURE") !== "1", keepAlive: true });
function req(p, { method = "GET", body, cookie } = {}) {
  const u = new URL(p.replace(/^\//, ""), BASE.endsWith("/") ? BASE : BASE + "/");
  return new Promise((res, rej) => { const r = https.request({ hostname: u.hostname, port: u.port || 443, path: u.pathname + u.search, method, agent, headers: { "Content-Type": "application/json", Accept: "application/json", Prefer: "odata.maxpagesize=200", ...(cookie ? { Cookie: cookie } : {}) } }, (x) => { let d = ""; x.on("data", (c) => (d += c)); x.on("end", () => { let b = d; try { b = JSON.parse(d); } catch {} res({ status: x.statusCode, headers: x.headers, body: b }); }); }); r.on("error", rej); if (body) r.write(JSON.stringify(body)); r.end(); });
}

const LOT_PENDING = "EM_PENDING";

async function main() {
  const login = await req("Login", { method: "POST", body: { CompanyDB: g("SAP_B1_COMPANY_DB"), UserName: g("SAP_B1_USERNAME"), Password: g("SAP_B1_PASSWORD") } });
  const set = login.headers["set-cookie"]; const cookie = Array.isArray(set) ? set.map((c) => c.split(";")[0]).join("; ") : "";
  console.log("Login", login.status, "—", g("SAP_B1_COMPANY_DB"));
  if (login.status !== 200) { console.log(JSON.stringify(login.body).slice(0, 300)); process.exit(1); }

  const day = process.argv[2] || new Date().toISOString().slice(0, 10);

  // ── 1. Requête EXACTE du bloc rétro fabrication ──────────────
  const q = `InventoryGenExits?$orderby=DocEntry asc`
    + `&$select=DocEntry,DocNum,DocumentLines`
    + `&$filter=${encodeURIComponent(`DocDate eq '${day}'`)}`;
  const r1 = await req(q, { cookie });
  console.log(`\n=== 1. InventoryGenExits du ${day} — HTTP ${r1.status} ===`);
  if (r1.status === 200) {
    const docs = r1.body.value || [];
    console.log(`  ${docs.length} sortie(s)`);
    for (const d of docs.slice(0, 5)) {
      console.log(`  Exit DocNum ${d.DocNum} (DocEntry ${d.DocEntry}) — ${(d.DocumentLines || []).length} ligne(s)`);
      for (const l of (d.DocumentLines || []).slice(0, 6)) {
        console.log(`    L${l.LineNum}  ${l.ItemCode}  qty=${l.Quantity}  whs=${l.WarehouseCode}  U_NoLot=${JSON.stringify(l.U_NoLot)}`);
      }
    }
  } else {
    console.log("  ERREUR:", JSON.stringify(r1.body).slice(0, 400));
  }

  // ── 2. Lignes EM_PENDING sur les 200 dernières sorties ───────
  const r2 = await req(
    `InventoryGenExits?$top=200&$orderby=DocEntry desc&$select=DocEntry,DocNum,DocDate,DocumentLines`,
    { cookie },
  );
  console.log(`\n=== 2. Sentinel ${LOT_PENDING} sur les 200 dernières sorties — HTTP ${r2.status} ===`);
  if (r2.status === 200) {
    let pending = 0;
    for (const d of (r2.body.value || [])) {
      for (const l of (d.DocumentLines || [])) {
        if (l.U_NoLot !== LOT_PENDING) continue;
        pending++;
        console.log(`  Exit ${d.DocNum} (${d.DocDate})  L${l.LineNum}  ${l.ItemCode}  qty=${l.Quantity}  → candidate propagation`);
      }
    }
    console.log(`  ${pending} ligne(s) ${LOT_PENDING} / ${(r2.body.value || []).length} sorties scannées`);
  } else {
    console.log("  ERREUR:", JSON.stringify(r2.body).slice(0, 400));
  }

  await req("Logout", { method: "POST", cookie });
}

main().catch((e) => { console.error(e); process.exit(1); });
