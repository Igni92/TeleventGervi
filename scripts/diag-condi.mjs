/**
 * Diag B4 — conditionnement NumInSale × SalPackUn (LECTURE SEULE, base PROD).
 *
 *   node scripts/diag-condi.mjs [ITEMCODE...]
 *
 * Inspecte sur de vrais articles (fraises & co) les champs unités SAP :
 *   SalesItemsPerUnit (NumInSale), SalesQtyPerPackUnit (SalPackUn), SalesUnit,
 *   SalesUnitWeight, InventoryUOM, U_GER_Det_Condt, U_GER_NB_BARQ_COLIS.
 * Objectif : déduire la formule exacte poids/colis + unités attendues à la commande.
 *
 * Plumbing identique à scripts/diag-fields.mjs.
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
  return new Promise((res, rej) => { const r = https.request({ hostname: u.hostname, port: u.port || 443, path: u.pathname + u.search, method, agent, headers: { "Content-Type": "application/json", Accept: "application/json", ...(cookie ? { Cookie: cookie } : {}) } }, (x) => { let d = ""; x.on("data", (c) => (d += c)); x.on("end", () => { let b = d; try { b = JSON.parse(d); } catch {} res({ status: x.statusCode, headers: x.headers, body: b }); }); }); r.on("error", rej); if (body) r.write(JSON.stringify(body)); r.end(); });
}

const SELECT = "ItemCode,ItemName,SalesItemsPerUnit,SalesQtyPerPackUnit,SalesUnit,SalesPackagingUnit,SalesUnitWeight,InventoryUOM,U_GER_Det_Condt,U_GER_NB_BARQ_COLIS,U_GER_UVC";

function row(it) {
  return {
    ItemCode: it.ItemCode,
    Name: (it.ItemName || "").slice(0, 28),
    NumInSale: it.SalesItemsPerUnit,      // SalesItemsPerUnit
    SalPackUn: it.SalesQtyPerPackUnit,    // SalesQtyPerPackUnit
    SalesUnit: it.SalesUnit,
    PackUnit: it.SalesPackagingUnit,
    UnitWgtKg: it.SalesUnitWeight,
    InvUOM: it.InventoryUOM,
    Condt: it.U_GER_Det_Condt,
    UVC: it.U_GER_UVC,
    NbBarq: it.U_GER_NB_BARQ_COLIS,
  };
}

async function main() {
  const login = await req("Login", { method: "POST", body: { CompanyDB: g("SAP_B1_COMPANY_DB"), UserName: g("SAP_B1_USERNAME"), Password: g("SAP_B1_PASSWORD") } });
  const set = login.headers["set-cookie"]; const cookie = Array.isArray(set) ? set.map((c) => c.split(";")[0]).join("; ") : "";
  console.log("Login", login.status, "—", g("SAP_B1_COMPANY_DB"));

  // ── Articles ciblés ────────────────────────────────────────
  const targets = process.argv.slice(2).length ? process.argv.slice(2) : ["FB4KA3", "FA4", "FA5", "FE1SL", "FRAMB12PD"];
  console.log("\n=== Articles ciblés ===");
  const rows = [];
  for (const code of targets) {
    const r = await req(`Items('${encodeURIComponent(code)}')?$select=${SELECT}`, { cookie });
    if (r.status === 200) rows.push(row(r.body));
    else console.log(`  ${code}: HTTP ${r.status} — ${JSON.stringify(r.body?.error?.message ?? r.body).slice(0, 120)}`);
  }
  console.table(rows);

  // ── Scan F* : repérer les conditionnements multi-unités (NumInSale > 1) ──
  console.log("=== Scan Items F* — articles avec SalesItemsPerUnit ≠ 1 ===");
  let skip = 0; const multi = [];
  for (;;) {
    const r = await req(`Items?$select=${SELECT}&$filter=${encodeURIComponent("startswith(ItemCode,'F')")}&$top=200&$skip=${skip}`, { cookie });
    if (r.status !== 200) { console.log("ERREUR scan:", JSON.stringify(r.body).slice(0, 200)); break; }
    const items = r.body.value || [];
    for (const it of items) {
      if ((it.SalesItemsPerUnit ?? 1) !== 1) multi.push(row(it));
    }
    if (items.length < 200) break;
    skip += items.length;
  }
  console.table(multi.slice(0, 40));
  console.log(`(${multi.length} articles F* avec NumInSale ≠ 1)`);

  // ── Exemple : comment une vraie ligne de commande fraise est unitée ──
  // ⚠️ Pas de filtre lambda DocumentLines/any(...) : ce Service Layer le rejette
  // (HTTP 400 "Invalid symbol") — on scanne côté client les commandes récentes.
  console.log("\n=== Dernières lignes de commande sur articles ciblés (unités réelles) ===");
  const wanted = new Set(targets);
  let skipO = 0, found = 0;
  for (; found < 12 && skipO < 600;) {
    const r = await req(
      `Orders?$select=DocNum,DocDate,DocumentLines&$orderby=DocEntry desc&$top=200&$skip=${skipO}`,
      { cookie },
    );
    if (r.status !== 200) { console.log("ERREUR:", JSON.stringify(r.body).slice(0, 200)); break; }
    const docs = r.body.value || [];
    for (const d of docs) {
      for (const l of (d.DocumentLines || []).filter((x) => wanted.has(x.ItemCode))) {
        console.log(`  #${d.DocNum} ${d.DocDate}  ${String(l.ItemCode).padEnd(10)} Quantity=${String(l.Quantity).padEnd(6)} MeasureUnit=${JSON.stringify(l.MeasureUnit)}  UnitsOfMeasurment=${JSON.stringify(l.UnitsOfMeasurment)}  InventoryQuantity=${JSON.stringify(l.InventoryQuantity)}  PackageQuantity=${JSON.stringify(l.PackageQuantity)}  UoMEntry=${JSON.stringify(l.UoMEntry)}`);
        found++;
      }
    }
    if (docs.length < 200) break;
    skipO += docs.length;
  }
  if (found === 0) console.log("  (aucune ligne trouvée sur les articles ciblés)");

  await req("Logout", { method: "POST", cookie });
}
main().catch((e) => console.error("ERR", e.message));
