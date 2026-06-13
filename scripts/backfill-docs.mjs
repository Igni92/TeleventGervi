/**
 * Rattrapage standalone — pull Orders + Invoices + CreditNotes + PDN +
 * PurchaseReturns (avoirs fournisseurs) depuis SAP PROD vers le miroir local.
 * Réplique fidèlement lib/sapMirror.ts (mêmes $select, dates quotées,
 * marge = Σ GrossProfit lignes, coût dérivé, HT = DocTotal−VatSum).
 *
 * Idempotent : ON CONFLICT (docEntry) DO UPDATE + delete/insert des lignes.
 *   Usage: node scripts/backfill-docs.mjs [--days 365] [--from 2024-01-01]
 *   (--from prime sur --days quand les deux sont fournis)
 */
import fs from "node:fs";
import https from "node:https";
import path from "node:path";
import { PrismaClient } from "@prisma/client";

// ── env (.env puis .env.local, déséchappe \$) ──
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
let cookie = "";

function req(p, o = {}) {
  const u = new URL(p.replace(/^\//, ""), BASE.endsWith("/") ? BASE : BASE + "/");
  return new Promise((res, rej) => {
    const r = https.request({ hostname: u.hostname, port: u.port || 443, path: u.pathname + u.search, method: o.method || "GET", agent,
      headers: { "Content-Type": "application/json", Accept: "application/json", Prefer: "odata.maxpagesize=100", ...(cookie ? { Cookie: cookie } : {}) } },
      (x) => { let d = ""; x.on("data", (c) => (d += c)); x.on("end", () => { let b = d; try { b = JSON.parse(d); } catch {} res({ status: x.statusCode, body: b, headers: x.headers }); }); });
    r.on("error", rej); if (o.body) r.write(JSON.stringify(o.body)); r.end();
  });
}

async function login() {
  const r = await req("Login", { method: "POST", body: { CompanyDB: g("SAP_B1_COMPANY_DB"), UserName: g("SAP_B1_USERNAME"), Password: g("SAP_B1_PASSWORD") } });
  if (r.status !== 200) throw new Error("Login SAP KO: " + r.status);
  const set = r.headers["set-cookie"];
  cookie = Array.isArray(set) ? set.map((c) => c.split(";")[0]).join("; ") : "";
}

/** Pagination $skip — toutes les pages (re-login auto sur 401).
 *  Plafond 1000 pages × 100 = 100k docs : large pour ~2,5 ans d'historique. */
async function getAll(basePath) {
  const all = [];
  let skip = 0;
  for (let page = 0; page < 1000; page++) {
    const sep = basePath.includes("?") ? "&" : "?";
    let r = await req(`${basePath}${sep}$top=100&$skip=${skip}`);
    if (r.status === 401) { await login(); r = await req(`${basePath}${sep}$top=100&$skip=${skip}`); }
    if (r.status >= 400) throw new Error(`SAP ${basePath} p${page} → ${r.status}: ${JSON.stringify(r.body?.error?.message?.value ?? "").slice(0, 200)}`);
    const batch = r.body.value ?? [];
    all.push(...batch);
    if (batch.length < 100) break;
    skip += 100;
    if (page % 10 === 9) console.log(`    … ${all.length} docs`);
  }
  return all;
}

// ── Constantes identiques à lib/sapMirror.ts (post-fix) ──
const COMMON_SELECT_DOC = "DocEntry,DocNum,DocDate,CardCode,CardName,SalesPersonCode,DocTotal,VatSum,Cancelled,UpdateDate";
const SELECT_DOC_LINES = `$select=${COMMON_SELECT_DOC},DocumentLines`;
const SELECT_PDN_LINES = "$select=DocEntry,DocNum,DocDate,CardCode,CardName,DocTotal,Cancelled,UpdateDate,DocumentLines";

// Pool Supabase (session mode) limité à 15 clients — le dev server en tient
// déjà plusieurs. On se restreint à 2 connexions et on écrit en bulk séquentiel.
const dbUrl = (() => {
  const u = g("DATABASE_URL");
  if (!u) return undefined;
  const sep = u.includes("?") ? "&" : "?";
  return u.includes("connection_limit") ? u : `${u}${sep}connection_limit=2&pool_timeout=60`;
})();
const prisma = new PrismaClient(dbUrl ? { datasources: { db: { url: dbUrl } } } : undefined);
const BATCH = 200; // docs par lot (en-têtes + lignes en 3 requêtes bulk)

function mapLines(doc) {
  return (doc.DocumentLines ?? []).map((l) => {
    const qty = l.Quantity ?? 0;
    const lineTotal = l.LineTotal ?? 0;
    const gp = l.GrossProfit ?? null;
    const lineCost = gp != null && qty > 0 ? (lineTotal - gp) / qty : null;
    // isService : ligne sans ItemCode = prestation/location/refacturation
    // (convention prisma/schema.prisma) — ignoré pour les PDN.
    return { lineNum: l.LineNum, itemCode: l.ItemCode ?? null, itemDescription: l.ItemDescription ?? null,
      quantity: qty, lineTotal, lineCost, grossProfit: gp, warehouseCode: l.WarehouseCode ?? null,
      isService: l.ItemCode == null };
  });
}

async function ensureBps(docs, cardType) {
  const codes = Array.from(new Set(docs.map((d) => d.CardCode)));
  if (!codes.length) return;
  const existing = await prisma.sapBusinessPartner.findMany({ where: { cardCode: { in: codes } }, select: { cardCode: true } });
  const have = new Set(existing.map((e) => e.cardCode));
  const missing = codes.filter((c) => !have.has(c));
  if (missing.length) {
    await prisma.sapBusinessPartner.createMany({
      data: missing.map((cardCode) => {
        const sample = docs.find((d) => d.CardCode === cardCode);
        return { cardCode, cardName: sample?.CardName || cardCode, cardType, active: true };
      }),
      skipDuplicates: true,
    });
    console.log(`    +${missing.length} BP minimaux (${cardType})`);
  }
}

async function upsertDocs(docs, { headerTable, lineTable, slpMap, withSlp, withGp }) {
  let maxUpdate = null;
  for (let i = 0; i < docs.length; i += BATCH) {
    const slice = docs.slice(i, i + BATCH);

    // ── 1 requête bulk pour les en-têtes du lot ──
    const hCols = withSlp
      ? ["docEntry", "docNum", "docDate", "cardCode", "cardName", "slpName", "docTotal", "vatSum", "grossProfit", "cancelled", "updateDate"]
      : ["docEntry", "docNum", "docDate", "cardCode", "cardName", "docTotal", "cancelled", "updateDate"];
    const hValues = []; const hParams = []; let hp = 1;
    const allLines = []; // { docEntry, ...ligne }

    for (const d of slice) {
      const lines = mapLines(d);
      const docGp = lines.reduce((s, l) => s + (l.grossProfit ?? 0), 0);
      const docTotal = (d.DocTotal ?? 0) - (d.VatSum ?? 0);
      const slpName = withSlp && d.SalesPersonCode != null && d.SalesPersonCode >= 0 ? slpMap.get(d.SalesPersonCode) ?? null : null;
      const upd = d.UpdateDate ? new Date(d.UpdateDate) : null;
      if (upd && (!maxUpdate || upd > maxUpdate)) maxUpdate = upd;

      const row = withSlp
        ? [d.DocEntry, d.DocNum ?? null, new Date(d.DocDate), d.CardCode, d.CardName ?? null, slpName, docTotal, d.VatSum ?? 0, withGp ? docGp : null, d.Cancelled === "tYES", upd]
        : [d.DocEntry, d.DocNum ?? null, new Date(d.DocDate), d.CardCode, d.CardName ?? null, docTotal, d.Cancelled === "tYES", upd];
      hValues.push(`(${row.map(() => `$${hp++}`).join(",")},NOW())`);
      hParams.push(...row);
      for (const l of lines) allLines.push({ docEntry: d.DocEntry, ...l });
    }

    const updateSet = hCols.filter((c) => c !== "docEntry").map((c) => `"${c}"=EXCLUDED."${c}"`).join(",");
    await prisma.$executeRawUnsafe(
      `INSERT INTO "${headerTable}" (${hCols.map((c) => `"${c}"`).join(",")},"syncedAt") VALUES ${hValues.join(",")}
       ON CONFLICT ("docEntry") DO UPDATE SET ${updateSet},"syncedAt"=NOW()`,
      ...hParams);

    // ── 1 DELETE + 1 INSERT bulk pour les lignes du lot ──
    // Lignes "achat" (PDN + retours fournisseurs) : pas de lineCost/grossProfit.
    const purchaseLines = lineTable === "SapPdnLine" || lineTable === "SapPurchaseReturnLine";
    const entries = slice.map((d) => d.DocEntry);
    await prisma.$executeRawUnsafe(`DELETE FROM "${lineTable}" WHERE "docEntry" = ANY($1::int[])`, entries);
    if (allLines.length) {
      const lCols = purchaseLines
        ? ["docEntry", "lineNum", "itemCode", "itemDescription", "quantity", "lineTotal", "warehouseCode"]
        : ["docEntry", "lineNum", "itemCode", "itemDescription", "quantity", "lineTotal", "lineCost", "grossProfit", "warehouseCode", "isService"];
      // Postgres max ~65k params → sous-lots de lignes.
      const perRow = lCols.length;
      const maxRows = Math.floor(60000 / perRow);
      for (let j = 0; j < allLines.length; j += maxRows) {
        const ls = allLines.slice(j, j + maxRows);
        const values = []; const params = []; let p = 1;
        for (const l of ls) {
          const row = purchaseLines
            ? [l.docEntry, l.lineNum, l.itemCode, l.itemDescription, l.quantity, l.lineTotal, l.warehouseCode]
            : [l.docEntry, l.lineNum, l.itemCode, l.itemDescription, l.quantity, l.lineTotal, l.lineCost, l.grossProfit, l.warehouseCode, l.isService];
          values.push(`(${row.map(() => `$${p++}`).join(",")})`);
          params.push(...row);
        }
        await prisma.$executeRawUnsafe(
          `INSERT INTO "${lineTable}" (${lCols.map((c) => `"${c}"`).join(",")}) VALUES ${values.join(",")} ON CONFLICT ("docEntry","lineNum") DO NOTHING`,
          ...params);
      }
    }
    console.log(`    … upsert ${Math.min(i + BATCH, docs.length)}/${docs.length}`);
  }
  return maxUpdate;
}

async function main() {
  // --from YYYY-MM-DD prime sur --days (rattrapage historique, ex. 2024-01-01).
  const fromIdx = process.argv.indexOf("--from");
  const daysIdx = process.argv.indexOf("--days");
  let from;
  if (fromIdx > -1) {
    from = new Date(`${process.argv[fromIdx + 1]}T00:00:00Z`);
    if (Number.isNaN(from.getTime())) { throw new Error(`--from invalide : ${process.argv[fromIdx + 1]} (attendu YYYY-MM-DD)`); }
  } else {
    const days = daysIdx > -1 ? parseInt(process.argv[daysIdx + 1]) : 365;
    from = new Date(); from.setDate(from.getDate() - days);
  }
  const FROM = `'${from.toISOString().slice(0, 10)}'`;

  await login();
  console.log(`Login OK — ${g("SAP_B1_COMPANY_DB")} · backfill depuis ${FROM}\n`);

  const slps = await getAll("SalesPersons?$select=SalesEmployeeCode,SalesEmployeeName");
  const slpMap = new Map(slps.map((s) => [s.SalesEmployeeCode, s.SalesEmployeeName]));

  // — Orders —
  console.log("📦 Orders…");
  const orders = await getAll(`Orders?${SELECT_DOC_LINES}&$filter=DocDate ge ${FROM}&$orderby=DocEntry asc`);
  console.log(`    ${orders.length} docs SAP`);
  await ensureBps(orders, "C");
  const ordMax = await upsertDocs(orders, { headerTable: "SapOrder", lineTable: "SapOrderLine", slpMap, withSlp: true, withGp: true });

  // — Invoices —
  console.log("🧮 Invoices…");
  const invoices = await getAll(`Invoices?${SELECT_DOC_LINES}&$filter=DocDate ge ${FROM}&$orderby=DocEntry asc`);
  console.log(`    ${invoices.length} docs SAP`);
  await ensureBps(invoices, "C");
  const invMax = await upsertDocs(invoices, { headerTable: "SapInvoice", lineTable: "SapInvoiceLine", slpMap, withSlp: true, withGp: true });

  // — CreditNotes —
  console.log("🧾 CreditNotes…");
  const cns = await getAll(`CreditNotes?${SELECT_DOC_LINES}&$filter=DocDate ge ${FROM}&$orderby=DocEntry asc`);
  console.log(`    ${cns.length} docs SAP`);
  await ensureBps(cns, "C");
  const cnMax = await upsertDocs(cns, { headerTable: "SapCreditNote", lineTable: "SapCreditNoteLine", slpMap, withSlp: true, withGp: true });

  // — PDN —
  console.log("🚚 PurchaseDeliveryNotes…");
  const pdns = await getAll(`PurchaseDeliveryNotes?${SELECT_PDN_LINES}&$filter=DocDate ge ${FROM}&$orderby=DocEntry asc`);
  console.log(`    ${pdns.length} docs SAP`);
  await ensureBps(pdns, "V");
  const pdnMax = await upsertDocs(pdns, { headerTable: "SapPurchaseDeliveryNote", lineTable: "SapPdnLine", slpMap, withSlp: false, withGp: false });

  // — PurchaseReturns (avoirs fournisseurs) — mêmes conventions que les PDN —
  console.log("↩️ PurchaseReturns…");
  const prets = await getAll(`PurchaseReturns?${SELECT_PDN_LINES}&$filter=DocDate ge ${FROM}&$orderby=DocEntry asc`);
  console.log(`    ${prets.length} docs SAP`);
  await ensureBps(prets, "V");
  const pretMax = await upsertDocs(prets, { headerTable: "SapPurchaseReturn", lineTable: "SapPurchaseReturnLine", slpMap, withSlp: false, withGp: false });

  // — Curseur (équivalent fin de backfill) —
  try {
    await prisma.$executeRawUnsafe(
      `UPDATE "SapMirrorCursor" SET "lastOrderUpdate"=$1, "lastInvoiceUpdate"=$2, "lastCreditNoteUpdate"=$3,
              "lastPdnUpdate"=$4, "lastPurchaseReturnUpdate"=$5, "lastTickAt"=NOW() WHERE id=1`,
      ordMax, invMax, cnMax, pdnMax, pretMax);
  } catch (e) { console.warn("curseur:", e.message.split("\n")[0]); }

  // — Vérif finale —
  const [counts] = await prisma.$queryRawUnsafe(
    `SELECT (SELECT COUNT(*) FROM "SapOrder")::int AS orders, (SELECT COUNT(*) FROM "SapInvoice")::int AS invoices,
            (SELECT COUNT(*) FROM "SapCreditNote")::int AS cns,
            (SELECT COUNT(*) FROM "SapPurchaseDeliveryNote")::int AS pdns,
            (SELECT COUNT(*) FROM "SapPurchaseReturn")::int AS prets,
            (SELECT MAX("docDate")::text FROM "SapOrder") AS last_order`);
  console.log("\n✅ Terminé :", counts);
  for (const code of ["APLAI", "AMARNE"]) {
    const r = await prisma.$queryRawUnsafe(
      `SELECT "docNum", "docDate"::text, "docTotal" FROM "SapOrder" WHERE "cardCode"=$1 ORDER BY "docDate" DESC LIMIT 2`, code);
    console.log(`   ${code}:`, r);
  }
  await req("Logout", { method: "POST" });
}

main()
  .catch((e) => { console.error("❌", e.message); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
