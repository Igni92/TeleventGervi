/**
 * SMOKE PILOTAGE — POST réel SAP + Backfill mirror local.
 *
 * Phase 1 : POST 10 Orders + 5 PurchaseDeliveryNotes dans SAP (DocDate today,
 *           clients/fournisseurs/items existants choisis aléatoirement).
 * Phase 2 : Backfill mirror local depuis SAP : BusinessPartners + Invoices +
 *           Orders + PurchaseDeliveryNotes >= 2024-01-01 → tables Sap* locales.
 *
 * Tous les docs créés portent NumAtCard = "SMOKE-PILOTAGE-<i>" → annulables
 * facilement via Filter NumAtCard contains "SMOKE-PILOTAGE".
 *
 * Usage :
 *   node scripts/smoke-pilotage.mjs                 # POST + backfill (full)
 *   node scripts/smoke-pilotage.mjs --post-only     # POST seul
 *   node scripts/smoke-pilotage.mjs --backfill-only # Backfill seul
 *   node scripts/smoke-pilotage.mjs --from=2025-01-01 # Backfill depuis date
 */
import https from "node:https";
import fs from "node:fs";
import { URL } from "node:url";
import { PrismaClient } from "@prisma/client";

// ─────────────────────────────────────────────────────────────
// Args + env
// ─────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const POST_ONLY = args.includes("--post-only");
const BACKFILL_ONLY = args.includes("--backfill-only");
const fromArg = args.find((a) => a.startsWith("--from="));
const FROM = fromArg ? fromArg.slice(7) : "2024-01-01";
const N_ORDERS = parseInt(args.find((a) => a.startsWith("--orders="))?.slice(9) || "10");
const N_PDN = parseInt(args.find((a) => a.startsWith("--pdn="))?.slice(6) || "5");

function loadEnv(p) {
  if (!fs.existsSync(p)) return;
  for (const line of fs.readFileSync(p, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (m && !process.env[m[1]]) {
      let v = m[2].trim();
      if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1);
      v = v.replace(/\\\$/g, "$");
      process.env[m[1]] = v;
    }
  }
}
loadEnv(".env.local");
loadEnv(".env");

const SAP_BASE = process.env.SAP_B1_BASE_URL;
const SAP_DB = process.env.SAP_B1_COMPANY_DB;
const SAP_USER = process.env.SAP_B1_USERNAME;
const SAP_PASS = process.env.SAP_B1_PASSWORD;
if (!SAP_BASE || !SAP_DB || !SAP_USER || !SAP_PASS) {
  console.error("❌ Variables SAP manquantes dans .env.local : SAP_B1_BASE_URL/COMPANY_DB/USERNAME/PASSWORD");
  process.exit(1);
}

// ─────────────────────────────────────────────────────────────
// Helpers SAP (HTTPS raw — pas d'imports TS)
// ─────────────────────────────────────────────────────────────
let cookies = "";
function req(method, path, opts = {}) {
  return new Promise((res, rej) => {
    // URL-encode tous les caractères spéciaux OData (() = ' espace) sauf ceux
    // déjà valides en path/query. encodeURI préserve ?, &, =, /, mais encode
    // espaces, ( ), '. C'est ce que veut SAP B1 Service Layer.
    const encoded = encodeURI(path);
    const t = new URL(encoded, SAP_BASE.endsWith("/") ? SAP_BASE : SAP_BASE + "/");
    const r = https.request({
      hostname: t.hostname,
      port: t.port || 443,
      path: t.pathname + t.search,
      method,
      rejectUnauthorized: false,
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        ...(cookies ? { Cookie: cookies } : {}),
        ...(opts.prefer ? { Prefer: opts.prefer } : {}),
      },
    }, (resp) => {
      let d = "";
      resp.on("data", (c) => d += c);
      resp.on("end", () => {
        let p = d;
        try { p = JSON.parse(d); } catch { /* keep string */ }
        res({ status: resp.statusCode, body: p, headers: resp.headers });
      });
    });
    r.on("error", rej);
    if (opts.body) r.write(JSON.stringify(opts.body));
    r.end();
  });
}

async function login() {
  const r = await req("POST", "Login", { body: { CompanyDB: SAP_DB, UserName: SAP_USER, Password: SAP_PASS } });
  if (r.status !== 200) throw new Error(`Login failed: ${r.status} ${JSON.stringify(r.body).slice(0, 200)}`);
  cookies = (r.headers["set-cookie"] || []).map((c) => c.split(";")[0]).join("; ");
  console.log(`✅ Login OK — DB: ${SAP_DB}`);
}

async function logout() {
  if (!cookies) return;
  try { await req("POST", "Logout"); } catch {}
  cookies = "";
}

/** Paginate /BusinessPartners-style endpoints with $top + $skip. */
async function getAll(path, pageSize = 200, maxPages = 200) {
  const all = [];
  let skip = 0;
  for (let i = 0; i < maxPages; i++) {
    const sep = path.includes("?") ? "&" : "?";
    const url = `${path}${sep}$top=${pageSize}&$skip=${skip}`;
    const r = await req("GET", url, { prefer: `odata.maxpagesize=${pageSize}` });
    if (r.status >= 400) {
      const msg = r.body?.error?.message?.value ?? JSON.stringify(r.body).slice(0, 300);
      throw new Error(`GET ${url} → ${r.status}: ${msg}`);
    }
    const vals = r.body?.value ?? [];
    all.push(...vals);
    if (vals.length < pageSize) break;
    skip += vals.length;
  }
  return all;
}

// ─────────────────────────────────────────────────────────────
// RNG déterministe
// ─────────────────────────────────────────────────────────────
let _seed = 1024;
const rnd = () => { _seed = (_seed * 1103515245 + 12345) & 0x7fffffff; return _seed / 0x7fffffff; };
const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
const randInt = (a, b) => a + Math.floor(rnd() * (b - a + 1));
const r2 = (n) => Math.round(n * 100) / 100;

// ─────────────────────────────────────────────────────────────
// PHASE 1 : POST réel SAP (Orders + PDN)
// ─────────────────────────────────────────────────────────────
async function postSmokeBL() {
  console.log("\n" + "─".repeat(60));
  console.log(`PHASE 1 — POST ${N_ORDERS} Orders + ${N_PDN} PDN dans SAP`);
  console.log("─".repeat(60));

  // 1. BPs C et V valides
  const customers = await getAll("BusinessPartners?$filter=CardType eq 'cCustomer' and Valid eq 'tYES' and Frozen eq 'tNO'&$select=CardCode,CardName&$top=50", 50, 1);
  const vendors = await getAll("BusinessPartners?$filter=CardType eq 'cSupplier' and Valid eq 'tYES' and Frozen eq 'tNO'&$select=CardCode,CardName&$top=30", 30, 1);
  console.log(`  Clients dispo: ${customers.length} · Fournisseurs dispo: ${vendors.length}`);
  if (customers.length === 0 || vendors.length === 0) {
    console.error("❌ Pas de BPs valides — abandon phase 1");
    return { orders: [], pdns: [] };
  }

  // 2. Items en stock
  const items = await getAll(
    "Items?$filter=Valid eq 'tYES' and Frozen eq 'tNO' and QuantityOnStock gt 0"
    + "&$select=ItemCode,ItemName,SalesUnit,SalesQtyPerPackUnit,ItemWarehouseInfoCollection&$top=60",
    60, 1,
  );
  const stockedItems = items.filter((it) => {
    const wi = (it.ItemWarehouseInfoCollection || []).find((w) => ["000", "01", "R1"].includes(w.WarehouseCode));
    return wi && (wi.InStock - (wi.Committed ?? 0)) > 0;
  });
  console.log(`  Items avec dispo>0: ${stockedItems.length}`);
  if (stockedItems.length < 3) {
    console.error("❌ Pas assez d'items en stock — abandon phase 1");
    return { orders: [], pdns: [] };
  }

  const today = new Date().toISOString().slice(0, 10);

  // 3. POST Orders (BL)
  console.log("\n  → Orders …");
  const createdOrders = [];
  for (let i = 0; i < N_ORDERS; i++) {
    const card = pick(customers);
    const nLines = randInt(2, 4);
    const usedItems = new Set();
    const documentLines = [];
    for (let j = 0; j < nLines; j++) {
      const it = pick(stockedItems);
      if (usedItems.has(it.ItemCode)) continue;
      usedItems.add(it.ItemCode);
      const wh = pick(["000", "01"]);
      const wInfo = (it.ItemWarehouseInfoCollection || []).find((w) => w.WarehouseCode === wh);
      const avail = wInfo ? Math.max(1, wInfo.InStock - (wInfo.Committed ?? 0)) : 1;
      const qty = randInt(1, Math.min(20, Math.floor(avail)));
      const price = r2(1.5 + rnd() * 8);
      documentLines.push({
        ItemCode: it.ItemCode,
        Quantity: qty,
        WarehouseCode: wh,
        UnitPrice: price,
        Price: price,
      });
    }
    if (documentLines.length === 0) continue;
    const payload = {
      CardCode: card.CardCode,
      DocDate: today,
      DocDueDate: today,
      NumAtCard: `SMOKE-PILOTAGE-O${i + 1}`,
      Comments: "Smoke pilotage TeleVent — auto-généré",
      DocumentLines: documentLines,
    };
    const cr = await req("POST", "Orders", { body: payload });
    if (cr.status >= 200 && cr.status < 300) {
      createdOrders.push({ docEntry: cr.body.DocEntry, docNum: cr.body.DocNum, card: card.CardCode, total: cr.body.DocTotal, nLines: documentLines.length });
      process.stdout.write(`    ✅ Order #${cr.body.DocNum} (${card.CardCode}, ${documentLines.length}L, ${r2(cr.body.DocTotal ?? 0)}€)\n`);
    } else {
      const msg = cr.body?.error?.message?.value ?? JSON.stringify(cr.body).slice(0, 200);
      console.log(`    ❌ Order #${i + 1} échec: ${msg}`);
    }
  }
  console.log(`  → ${createdOrders.length}/${N_ORDERS} Orders créés`);

  // 4. POST PurchaseDeliveryNotes
  console.log("\n  → PurchaseDeliveryNotes …");
  const createdPdns = [];
  for (let i = 0; i < N_PDN; i++) {
    const vendor = pick(vendors);
    const nLines = randInt(2, 4);
    const usedItems = new Set();
    const documentLines = [];
    for (let j = 0; j < nLines; j++) {
      const it = pick(stockedItems);
      if (usedItems.has(it.ItemCode)) continue;
      usedItems.add(it.ItemCode);
      const wh = pick(["000", "01"]);
      const qty = randInt(20, 200);
      const price = r2(0.5 + rnd() * 4);
      documentLines.push({
        ItemCode: it.ItemCode,
        Quantity: qty,
        WarehouseCode: wh,
        UnitPrice: price,
        Price: price,
      });
    }
    if (documentLines.length === 0) continue;
    const payload = {
      CardCode: vendor.CardCode,
      DocDate: today,
      DocDueDate: today,
      NumAtCard: `SMOKE-PILOTAGE-P${i + 1}`,
      Comments: "Smoke pilotage TeleVent — entrée test",
      DocumentLines: documentLines,
    };
    const cr = await req("POST", "PurchaseDeliveryNotes", { body: payload });
    if (cr.status >= 200 && cr.status < 300) {
      createdPdns.push({ docEntry: cr.body.DocEntry, docNum: cr.body.DocNum, vendor: vendor.CardCode, total: cr.body.DocTotal, nLines: documentLines.length });
      process.stdout.write(`    ✅ PDN #${cr.body.DocNum} (${vendor.CardCode}, ${documentLines.length}L, ${r2(cr.body.DocTotal ?? 0)}€)\n`);
    } else {
      const msg = cr.body?.error?.message?.value ?? JSON.stringify(cr.body).slice(0, 200);
      console.log(`    ❌ PDN #${i + 1} échec: ${msg}`);
    }
  }
  console.log(`  → ${createdPdns.length}/${N_PDN} PDN créés`);

  return { orders: createdOrders, pdns: createdPdns };
}

// ─────────────────────────────────────────────────────────────
// PHASE 2 : Backfill mirror local
// ─────────────────────────────────────────────────────────────
const prisma = new PrismaClient();

/**
 * priceMap = (ItemCode|BatchNumber EM<docNum>) → prix d'achat unitaire réel.
 * Construit pendant `backfillPdns()` à partir de PDN.DocumentLines.BatchNumbers
 * (chaque ligne d'EM = un Item + un lot + un prix). Consommé pendant
 * `backfillSalesDocs()` pour calculer la marge réelle par ligne, plutôt que
 * d'utiliser StockPrice (moyenne pondérée SAP, imprécise au niveau lot).
 *
 * Fallback : si une ligne d'Invoice/Order n'a pas de U_NoLot connu ou que le
 * lot n'est pas dans le map, on retombe sur StockPrice (avg moving SAP).
 */
const priceMap = new Map();
/**
 * pricesByItem = Map<ItemCode, Array<{date: Date, price: number}>>
 * Trié par date ascendante. Utilisé en fallback quand pas de lot ou
 * lot = "EM0000" (sentinelle SAP pour items sans rattachement PDN).
 * Résolution : on cherche le **dernier prix d'achat connu avant la date
 * de la facture** (proxy LIFO/FIFO selon le contexte).
 */
const pricesByItem = new Map();
let pricesByItemSorted = false;

// Compteurs — transparence qualité résolution
let priceMapHits = 0;          // lot exact OK (utilisé tel quel, marge négative légitime)
let priceMapLastBefore = 0;    // pas de lot → dernier prix avant la docDate
let priceMapAnyKnown = 0;      // pas de prix avant → fallback premier prix connu
let priceMapFallbacks = 0;     // pas de prix du tout pour cet item → StockPrice
let priceMapNulls = 0;         // rien → null

function pushPriceForItem(itemCode, date, price) {
  if (!itemCode || price == null || !Number.isFinite(price) || price <= 0) return;
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return;
  if (!pricesByItem.has(itemCode)) pricesByItem.set(itemCode, []);
  pricesByItem.get(itemCode).push({ date, price });
  pricesByItemSorted = false;
}

function sortPricesByItemOnce() {
  if (pricesByItemSorted) return;
  for (const arr of pricesByItem.values()) {
    arr.sort((a, b) => a.date.getTime() - b.date.getTime());
  }
  pricesByItemSorted = true;
}

/**
 * Retourne le dernier prix d'achat connu pour `itemCode` avant (ou égal)
 * `salesDate`. Si aucun prix antérieur, renvoie le **premier** prix connu
 * (meilleur effort) — flagué via `priceMapAnyKnown`. Renvoie null si rien.
 */
function lastPriceBefore(itemCode, salesDate) {
  if (!itemCode) return { price: null, beforeDate: false };
  const arr = pricesByItem.get(itemCode);
  if (!arr || arr.length === 0) return { price: null, beforeDate: false };
  sortPricesByItemOnce();
  // Binary search du dernier index avec date <= salesDate
  let lo = 0, hi = arr.length - 1, hit = -1;
  const target = salesDate.getTime();
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (arr[mid].date.getTime() <= target) { hit = mid; lo = mid + 1; }
    else hi = mid - 1;
  }
  if (hit >= 0) return { price: arr[hit].price, beforeDate: true };
  return { price: arr[0].price, beforeDate: false };
}

/**
 * Résolution du coût d'achat ligne :
 *
 *   1. Lot exact via U_NoLot OU BatchNumbers (priceMap)
 *      → utilisé **tel quel** même si la marge est négative (cas légitimes :
 *        cadeau, refacturation, démarque). On ne s'autorise PAS à substituer
 *        un lot exact valide.
 *
 *   2. Si pas de lot OU lot = "EM0000" (sentinelle SAP pour items sans PDN) :
 *      → dernier prix d'achat connu pour cet item AVANT (ou =) la date de
 *        la facture (proxy "tarif courant au moment de la vente").
 *
 *   3. Sinon → StockPrice (moyenne mobile SAP)
 *   4. Sinon → null
 *
 * `salesDate` est obligatoire pour la résolution date-aware.
 */
function resolveLineCost(line, salesDate) {
  // ── Step 1 : lot exact (sauf sentinelle EM0000) ──
  let exact = null;
  if (line.U_NoLot && line.ItemCode && line.U_NoLot !== "EM0000") {
    exact = priceMap.get(`${line.ItemCode}|${line.U_NoLot}`) ?? null;
  }
  if (exact == null) {
    for (const bn of line.BatchNumbers ?? []) {
      if (!bn.BatchNumber || !line.ItemCode) continue;
      if (bn.BatchNumber === "EM0000" || bn.BatchNumber === "0000") continue;
      exact = priceMap.get(`${line.ItemCode}|${bn.BatchNumber}`)
            ?? priceMap.get(`${line.ItemCode}|EM${bn.BatchNumber}`)
            ?? null;
      if (exact != null) break;
    }
  }
  if (exact != null) { priceMapHits++; return exact; }

  // ── Step 2 : dernier prix d'achat avant la docDate ──
  if (line.ItemCode && salesDate instanceof Date) {
    const { price, beforeDate } = lastPriceBefore(line.ItemCode, salesDate);
    if (price != null) {
      if (beforeDate) priceMapLastBefore++;
      else priceMapAnyKnown++;
      return price;
    }
  }

  // ── Step 3 : StockPrice ──
  if (line.StockPrice != null) { priceMapFallbacks++; return line.StockPrice; }

  priceMapNulls++;
  return null;
}

function cardTypeChar(t) {
  return t === "cSupplier" ? "V" : "C";
}

async function backfillBPs() {
  console.log("\n  → BusinessPartners …");
  const bps = await getAll(
    "BusinessPartners?$select=CardCode,CardName,CardType,GroupCode,SalesPersonCode,EmailAddress,Phone1,Valid,UpdateDate"
    + "&$filter=CardType eq 'cCustomer' or CardType eq 'cSupplier'",
    500, 50,
  );
  // SalesPersons map
  const slps = await getAll("SalesPersons?$select=SalesEmployeeCode,SalesEmployeeName", 200, 5);
  const slpMap = new Map(slps.map((s) => [s.SalesEmployeeCode, s.SalesEmployeeName]));

  let n = 0;
  for (const bp of bps) {
    const safeName = bp.CardName ?? bp.CardCode;
    await prisma.sapBusinessPartner.upsert({
      where: { cardCode: bp.CardCode },
      update: {
        cardName: safeName,
        cardType: cardTypeChar(bp.CardType),
        groupCode: bp.GroupCode ?? null,
        slpName: bp.SalesPersonCode != null ? slpMap.get(bp.SalesPersonCode) ?? null : null,
        email: bp.EmailAddress ?? null,
        phone: bp.Phone1 ?? null,
        active: bp.Valid !== "tNO",
        updateDate: bp.UpdateDate ? new Date(bp.UpdateDate) : null,
        syncedAt: new Date(),
      },
      create: {
        cardCode: bp.CardCode,
        cardName: safeName,
        cardType: cardTypeChar(bp.CardType),
        groupCode: bp.GroupCode ?? null,
        slpName: bp.SalesPersonCode != null ? slpMap.get(bp.SalesPersonCode) ?? null : null,
        email: bp.EmailAddress ?? null,
        phone: bp.Phone1 ?? null,
        active: bp.Valid !== "tNO",
        updateDate: bp.UpdateDate ? new Date(bp.UpdateDate) : null,
      },
    });
    n++;
  }
  console.log(`    ✅ ${n} BPs upserted`);
  return slpMap;
}

async function backfillSalesDocs(endpoint, slpMap) {
  const tableName = endpoint === "Invoices" ? "Invoice" : "Order";
  console.log(`\n  → ${endpoint} depuis ${FROM} …`);
  // SAP B1 Service Layer = pas de nested $select dans $expand. On expand brut
  // et on prend tous les champs des lignes, puis on filtre côté JS.
  // SAP B1 v10 : DocumentLines n'est navigable que si $select inclut explicitement
  // DocumentLines ET tous les champs du header voulus (sinon l'entité est typée
  // génériquement 'Document' et l'expand est rejeté).
  // SAP B1 SL v10 nonstandard : $select=...,DocumentLines retourne directement
  // les DocumentLines inline (cf. scripts/smoke-test-bl.mjs déjà utilisé en prod).
  // Pas besoin de $expand. C'est ce qui marche réellement contre cette version.
  // Note : `GrossProfit` n'existe pas sur le header Invoices/Orders dans cette
  // version SAP B1. La marge sera reconstituée côté script à partir des lignes
  // (lineTotal − quantity × StockPrice).
  const docs = await getAll(
    `${endpoint}?$select=DocEntry,DocNum,DocDate,CardCode,CardName,SalesPersonCode,DocTotal,VatSum,Cancelled,UpdateDate,DocumentLines`
    + `&$filter=DocDate ge '${FROM}'&$orderby=DocEntry asc`,
    100, 200,
  );

  // Auto-create missing BPs to avoid FK violation
  const seen = new Set(docs.map((d) => d.CardCode));
  const existing = await prisma.sapBusinessPartner.findMany({
    where: { cardCode: { in: Array.from(seen) } },
    select: { cardCode: true },
  });
  const haveSet = new Set(existing.map((b) => b.cardCode));
  const missing = Array.from(seen).filter((c) => !haveSet.has(c));
  if (missing.length > 0) {
    await prisma.sapBusinessPartner.createMany({
      data: missing.map((cardCode) => {
        const sample = docs.find((d) => d.CardCode === cardCode);
        return { cardCode, cardName: sample?.CardName ?? cardCode, cardType: "C", active: true };
      }),
      skipDuplicates: true,
    });
  }

  // OPTIM bulk : delete-all-in-scope + createMany. 4 queries par batch de 500
  // au lieu de ~5×N upserts individuels. Gain ~50×.
  const BATCH = 500;
  const buildCommon = (d) => {
    const docTotal = d.DocTotal ?? 0;
    const vatSum = d.VatSum ?? 0;
    const slpName = d.SalesPersonCode != null && d.SalesPersonCode >= 0 ? slpMap.get(d.SalesPersonCode) ?? null : null;
    return {
      docEntry: d.DocEntry,
      docNum: d.DocNum ?? null,
      docDate: new Date(d.DocDate),
      cardCode: d.CardCode,
      cardName: d.CardName ?? null,
      slpName,
      docTotal: r2(docTotal - vatSum),
      vatSum,
      grossProfit: null,            // patché après calcul des lignes
      cancelled: d.Cancelled === "tYES",
      updateDate: d.UpdateDate ? new Date(d.UpdateDate) : null,
      syncedAt: new Date(),
    };
  };
  const buildLines = (d) => {
    let headerGp = 0;
    const docDate = new Date(d.DocDate);
    const arr = (d.DocumentLines ?? []).map((l) => {
      const qty = l.Quantity ?? 0;
      const lineTotal = l.LineTotal ?? 0;
      const cost = resolveLineCost(l, docDate);
      const gp = cost != null ? lineTotal - qty * cost : null;
      if (gp != null) headerGp += gp;
      const noItem = l.ItemCode == null || l.ItemCode === "";
      return {
        docEntry: d.DocEntry,
        lineNum: l.LineNum,
        itemCode: noItem ? null : l.ItemCode,
        itemDescription: l.ItemDescription ?? null,
        quantity: qty,
        lineTotal,
        lineCost: cost,
        grossProfit: gp,
        warehouseCode: l.WarehouseCode ?? null,
        isService: noItem,
      };
    });
    return { lines: arr, gp: r2(headerGp) };
  };

  let n = 0;
  for (let i = 0; i < docs.length; i += BATCH) {
    const batch = docs.slice(i, i + BATCH);
    const docEntries = batch.map((d) => d.DocEntry);

    // 1. Build headers + lines en mémoire (résout la marge)
    const headers = batch.map((d) => {
      const c = buildCommon(d);
      const { lines, gp } = buildLines(d);
      c.grossProfit = gp;
      return { header: c, lines };
    });
    const allLines = headers.flatMap((h) => h.lines);
    const headerRows = headers.map((h) => h.header);

    // 2. Delete-all-in-scope (lines d'abord → FK), header ensuite
    if (endpoint === "Invoices") {
      await prisma.sapInvoiceLine.deleteMany({ where: { docEntry: { in: docEntries } } });
      await prisma.sapInvoice.deleteMany({ where: { docEntry: { in: docEntries } } });
      await prisma.sapInvoice.createMany({ data: headerRows, skipDuplicates: true });
      if (allLines.length > 0) await prisma.sapInvoiceLine.createMany({ data: allLines, skipDuplicates: true });
    } else {
      await prisma.sapOrderLine.deleteMany({ where: { docEntry: { in: docEntries } } });
      await prisma.sapOrder.deleteMany({ where: { docEntry: { in: docEntries } } });
      await prisma.sapOrder.createMany({ data: headerRows, skipDuplicates: true });
      if (allLines.length > 0) await prisma.sapOrderLine.createMany({ data: allLines, skipDuplicates: true });
    }

    n += batch.length;
    if (i % (BATCH * 4) === 0 && i > 0) {
      console.log(`    … ${n.toLocaleString("fr-FR")}/${docs.length.toLocaleString("fr-FR")} ${tableName}s`);
    }
  }
  console.log(`    ✅ ${n} ${tableName}s upserted`);
}

async function backfillPdns() {
  console.log(`\n  → PurchaseDeliveryNotes depuis ${FROM} …`);
  const docs = await getAll(
    `PurchaseDeliveryNotes?$select=DocEntry,DocNum,DocDate,CardCode,CardName,DocTotal,Cancelled,UpdateDate,DocumentLines`
    + `&$filter=DocDate ge '${FROM}'&$orderby=DocEntry asc`,
    100, 200,
  );

  // Auto-create missing BPs (vendors)
  const seen = new Set(docs.map((d) => d.CardCode));
  const existing = await prisma.sapBusinessPartner.findMany({
    where: { cardCode: { in: Array.from(seen) } },
    select: { cardCode: true },
  });
  const haveSet = new Set(existing.map((b) => b.cardCode));
  const missing = Array.from(seen).filter((c) => !haveSet.has(c));
  if (missing.length > 0) {
    await prisma.sapBusinessPartner.createMany({
      data: missing.map((cardCode) => {
        const sample = docs.find((d) => d.CardCode === cardCode);
        return { cardCode, cardName: sample?.CardName ?? cardCode, cardType: "V", active: true };
      }),
      skipDuplicates: true,
    });
  }

  // OPTIM bulk : delete-all-in-scope + createMany par batch de 500.
  const BATCH = 500;
  let n = 0;
  for (let i = 0; i < docs.length; i += BATCH) {
    const batch = docs.slice(i, i + BATCH);
    const docEntries = batch.map((d) => d.DocEntry);

    const headerRows = batch.map((d) => ({
      docEntry: d.DocEntry,
      docNum: d.DocNum ?? null,
      docDate: new Date(d.DocDate),
      cardCode: d.CardCode,
      cardName: d.CardName ?? null,
      docTotal: d.DocTotal ?? 0,
      cancelled: d.Cancelled === "tYES",
      updateDate: d.UpdateDate ? new Date(d.UpdateDate) : null,
      syncedAt: new Date(),
    }));
    const allLines = [];
    for (const d of batch) {
      for (const l of d.DocumentLines ?? []) {
        const qty = l.Quantity ?? 0;
        const lineTotal = l.LineTotal ?? 0;
        const noItem = l.ItemCode == null || l.ItemCode === "";
        const unitPrice = qty > 0 ? lineTotal / qty : (l.Price ?? l.UnitPrice ?? null);
        // POPULATE priceMap (uniquement pour les vraies lignes produit)
        if (!noItem && unitPrice != null && d.DocNum != null) {
          priceMap.set(`${l.ItemCode}|EM${d.DocNum}`, unitPrice);
          // Et indexer pour fallback "dernier prix avant date facture"
          pushPriceForItem(l.ItemCode, new Date(d.DocDate), unitPrice);
        }
        if (!noItem) {
          for (const bn of l.BatchNumbers ?? []) {
            if (bn.BatchNumber && unitPrice != null) {
              priceMap.set(`${l.ItemCode}|${bn.BatchNumber}`, unitPrice);
            }
          }
        }
        allLines.push({
          docEntry: d.DocEntry,
          lineNum: l.LineNum,
          itemCode: noItem ? null : l.ItemCode,
          itemDescription: l.ItemDescription ?? null,
          quantity: qty,
          lineTotal,
          warehouseCode: l.WarehouseCode ?? null,
          isService: noItem,
        });
      }
    }
    await prisma.sapPdnLine.deleteMany({ where: { docEntry: { in: docEntries } } });
    await prisma.sapPurchaseDeliveryNote.deleteMany({ where: { docEntry: { in: docEntries } } });
    await prisma.sapPurchaseDeliveryNote.createMany({ data: headerRows, skipDuplicates: true });
    if (allLines.length > 0) await prisma.sapPdnLine.createMany({ data: allLines, skipDuplicates: true });

    n += batch.length;
    if (i % (BATCH * 4) === 0 && i > 0) {
      console.log(`    … ${n.toLocaleString("fr-FR")}/${docs.length.toLocaleString("fr-FR")} PDN`);
    }
  }
  console.log(`    ✅ ${n} PDN upserted`);
}

async function updateCursor() {
  await prisma.sapMirrorCursor.upsert({
    where: { id: 1 },
    update: { lastTickAt: new Date(), lastBpUpdate: new Date() },
    create: { id: 1, lastTickAt: new Date(), lastBpUpdate: new Date() },
  });
}

/* ─────────────────────────────────────────────────────────────────
   Avoirs clients (CreditNotes SAP) — annulent du CA Invoices.
   Pattern identique aux Invoices : header + lines + bulk upsert.
   ───────────────────────────────────────────────────────────────── */
async function backfillCreditNotes(slpMap) {
  console.log(`\n  → CreditNotes depuis ${FROM} …`);
  const docs = await getAll(
    `CreditNotes?$select=DocEntry,DocNum,DocDate,CardCode,CardName,SalesPersonCode,DocTotal,VatSum,Cancelled,UpdateDate,DocumentLines`
    + `&$filter=DocDate ge '${FROM}'&$orderby=DocEntry asc`,
    100, 200,
  );

  // BP auto-create
  const seen = new Set(docs.map((d) => d.CardCode));
  const existing = await prisma.sapBusinessPartner.findMany({
    where: { cardCode: { in: Array.from(seen) } },
    select: { cardCode: true },
  });
  const haveSet = new Set(existing.map((b) => b.cardCode));
  const missing = Array.from(seen).filter((c) => !haveSet.has(c));
  if (missing.length > 0) {
    await prisma.sapBusinessPartner.createMany({
      data: missing.map((cardCode) => {
        const sample = docs.find((d) => d.CardCode === cardCode);
        return { cardCode, cardName: sample?.CardName ?? cardCode, cardType: "C", active: true };
      }),
      skipDuplicates: true,
    });
  }

  const BATCH = 500;
  let n = 0;
  for (let i = 0; i < docs.length; i += BATCH) {
    const batch = docs.slice(i, i + BATCH);
    const docEntries = batch.map((d) => d.DocEntry);
    const headerRows = [];
    const allLines = [];
    for (const d of batch) {
      const docTotal = d.DocTotal ?? 0;
      const vatSum = d.VatSum ?? 0;
      const slpName = d.SalesPersonCode != null && d.SalesPersonCode >= 0 ? slpMap.get(d.SalesPersonCode) ?? null : null;
      const docDate = new Date(d.DocDate);
      let headerGp = 0;
      let baseInvoiceEntry = null;
      const lines = (d.DocumentLines ?? []).map((l) => {
        const qty = l.Quantity ?? 0;
        const lineTotal = l.LineTotal ?? 0;
        const cost = resolveLineCost(l, docDate);
        const gp = cost != null ? lineTotal - qty * cost : null;
        if (gp != null) headerGp += gp;
        if (baseInvoiceEntry === null && l.BaseEntry != null && l.BaseType === 13) {
          // BaseType 13 = Invoice (SAP doc type)
          baseInvoiceEntry = l.BaseEntry;
        }
        const noItem = l.ItemCode == null || l.ItemCode === "";
        return {
          docEntry: d.DocEntry,
          lineNum: l.LineNum,
          itemCode: noItem ? null : l.ItemCode,
          itemDescription: l.ItemDescription ?? null,
          quantity: qty,
          lineTotal,
          lineCost: cost,
          grossProfit: gp,
          warehouseCode: l.WarehouseCode ?? null,
          isService: noItem,
        };
      });
      headerRows.push({
        docEntry: d.DocEntry,
        docNum: d.DocNum ?? null,
        docDate: new Date(d.DocDate),
        cardCode: d.CardCode,
        cardName: d.CardName ?? null,
        slpName,
        docTotal: r2(docTotal - vatSum),
        vatSum,
        grossProfit: r2(headerGp),
        baseInvoiceEntry,
        cancelled: d.Cancelled === "tYES",
        updateDate: d.UpdateDate ? new Date(d.UpdateDate) : null,
        syncedAt: new Date(),
      });
      allLines.push(...lines);
    }
    await prisma.sapCreditNoteLine.deleteMany({ where: { docEntry: { in: docEntries } } });
    await prisma.sapCreditNote.deleteMany({ where: { docEntry: { in: docEntries } } });
    await prisma.sapCreditNote.createMany({ data: headerRows, skipDuplicates: true });
    if (allLines.length > 0) await prisma.sapCreditNoteLine.createMany({ data: allLines, skipDuplicates: true });
    n += batch.length;
    if (i % (BATCH * 4) === 0 && i > 0) {
      console.log(`    … ${n.toLocaleString("fr-FR")}/${docs.length.toLocaleString("fr-FR")} CreditNotes`);
    }
  }
  console.log(`    ✅ ${n} CreditNotes upserted`);
}

/* ─────────────────────────────────────────────────────────────────
   Retours fournisseur (PurchaseReturns SAP) — annulent du PDN.
   ───────────────────────────────────────────────────────────────── */
async function backfillPurchaseReturns() {
  console.log(`\n  → PurchaseReturns depuis ${FROM} …`);
  const docs = await getAll(
    `PurchaseReturns?$select=DocEntry,DocNum,DocDate,CardCode,CardName,DocTotal,Cancelled,UpdateDate,DocumentLines`
    + `&$filter=DocDate ge '${FROM}'&$orderby=DocEntry asc`,
    100, 200,
  );

  const seen = new Set(docs.map((d) => d.CardCode));
  const existing = await prisma.sapBusinessPartner.findMany({
    where: { cardCode: { in: Array.from(seen) } },
    select: { cardCode: true },
  });
  const haveSet = new Set(existing.map((b) => b.cardCode));
  const missing = Array.from(seen).filter((c) => !haveSet.has(c));
  if (missing.length > 0) {
    await prisma.sapBusinessPartner.createMany({
      data: missing.map((cardCode) => {
        const sample = docs.find((d) => d.CardCode === cardCode);
        return { cardCode, cardName: sample?.CardName ?? cardCode, cardType: "V", active: true };
      }),
      skipDuplicates: true,
    });
  }

  const BATCH = 500;
  let n = 0;
  for (let i = 0; i < docs.length; i += BATCH) {
    const batch = docs.slice(i, i + BATCH);
    const docEntries = batch.map((d) => d.DocEntry);
    const headerRows = [];
    const allLines = [];
    for (const d of batch) {
      let basePdnEntry = null;
      const lines = (d.DocumentLines ?? []).map((l) => {
        if (basePdnEntry === null && l.BaseEntry != null && l.BaseType === 20) {
          // BaseType 20 = PurchaseDeliveryNote
          basePdnEntry = l.BaseEntry;
        }
        const noItem = l.ItemCode == null || l.ItemCode === "";
        return {
          docEntry: d.DocEntry,
          lineNum: l.LineNum,
          itemCode: noItem ? null : l.ItemCode,
          itemDescription: l.ItemDescription ?? null,
          quantity: l.Quantity ?? 0,
          lineTotal: l.LineTotal ?? 0,
          warehouseCode: l.WarehouseCode ?? null,
          isService: noItem,
        };
      });
      headerRows.push({
        docEntry: d.DocEntry,
        docNum: d.DocNum ?? null,
        docDate: new Date(d.DocDate),
        cardCode: d.CardCode,
        cardName: d.CardName ?? null,
        docTotal: d.DocTotal ?? 0,
        basePdnEntry,
        cancelled: d.Cancelled === "tYES",
        updateDate: d.UpdateDate ? new Date(d.UpdateDate) : null,
        syncedAt: new Date(),
      });
      allLines.push(...lines);
    }
    await prisma.sapPurchaseReturnLine.deleteMany({ where: { docEntry: { in: docEntries } } });
    await prisma.sapPurchaseReturn.deleteMany({ where: { docEntry: { in: docEntries } } });
    await prisma.sapPurchaseReturn.createMany({ data: headerRows, skipDuplicates: true });
    if (allLines.length > 0) await prisma.sapPurchaseReturnLine.createMany({ data: allLines, skipDuplicates: true });
    n += batch.length;
    if (i % (BATCH * 4) === 0 && i > 0) {
      console.log(`    … ${n.toLocaleString("fr-FR")}/${docs.length.toLocaleString("fr-FR")} PurchaseReturns`);
    }
  }
  console.log(`    ✅ ${n} PurchaseReturns upserted`);
}

async function reportFinalCounts() {
  console.log("\n" + "═".repeat(60));
  console.log("📊 Counts dans mirror local (toutes sources confondues)");
  console.log("═".repeat(60));
  console.log(`  SapBusinessPartner       : ${(await prisma.sapBusinessPartner.count()).toLocaleString("fr-FR")}`);
  console.log(`  SapInvoice               : ${(await prisma.sapInvoice.count()).toLocaleString("fr-FR")}`);
  console.log(`  SapInvoiceLine           : ${(await prisma.sapInvoiceLine.count()).toLocaleString("fr-FR")}`);
  console.log(`  SapOrder                 : ${(await prisma.sapOrder.count()).toLocaleString("fr-FR")}`);
  console.log(`  SapOrderLine             : ${(await prisma.sapOrderLine.count()).toLocaleString("fr-FR")}`);
  console.log(`  SapPurchaseDeliveryNote  : ${(await prisma.sapPurchaseDeliveryNote.count()).toLocaleString("fr-FR")}`);
  console.log(`  SapPdnLine               : ${(await prisma.sapPdnLine.count()).toLocaleString("fr-FR")}`);
  console.log(`  SapCreditNote            : ${(await prisma.sapCreditNote.count()).toLocaleString("fr-FR")} (avoirs clients)`);
  console.log(`  SapCreditNoteLine        : ${(await prisma.sapCreditNoteLine.count()).toLocaleString("fr-FR")}`);
  console.log(`  SapPurchaseReturn        : ${(await prisma.sapPurchaseReturn.count()).toLocaleString("fr-FR")} (retours fournisseur)`);
  console.log(`  SapPurchaseReturnLine    : ${(await prisma.sapPurchaseReturnLine.count()).toLocaleString("fr-FR")}`);

  console.log("\n📈 CA NET (Invoices − Avoirs) par année :");
  for (const y of [2024, 2025, 2026]) {
    const start = new Date(y, 0, 1);
    const end = new Date(y + 1, 0, 1);
    const [inv, cn] = await Promise.all([
      prisma.sapInvoice.aggregate({
        where: { docDate: { gte: start, lt: end }, cancelled: false },
        _sum: { docTotal: true, grossProfit: true },
        _count: { docEntry: true },
      }),
      prisma.sapCreditNote.aggregate({
        where: { docDate: { gte: start, lt: end }, cancelled: false },
        _sum: { docTotal: true, grossProfit: true },
        _count: { docEntry: true },
      }),
    ]);
    const caBrut = inv._sum.docTotal ?? 0;
    const caAvoirs = cn._sum.docTotal ?? 0;
    const caNet = caBrut - caAvoirs;
    const mgBrut = inv._sum.grossProfit ?? 0;
    const mgAvoirs = cn._sum.grossProfit ?? 0;
    const mgNet = mgBrut - mgAvoirs;
    const pctNet = caNet > 0 ? ((mgNet / caNet) * 100).toFixed(1) : "—";
    console.log(`  ${y} : CA brut ${caBrut.toLocaleString("fr-FR", { maximumFractionDigits: 0 })} − avoirs ${caAvoirs.toLocaleString("fr-FR", { maximumFractionDigits: 0 })} = NET ${caNet.toLocaleString("fr-FR", { maximumFractionDigits: 0 })} € · marge nette ${mgNet.toLocaleString("fr-FR", { maximumFractionDigits: 0 })} € (${pctNet}%) · ${inv._count.docEntry} fact, ${cn._count.docEntry} avoirs`);
  }

  console.log("\n💰 Achats NET (PDN − Retours) par année :");
  for (const y of [2024, 2025, 2026]) {
    const start = new Date(y, 0, 1);
    const end = new Date(y + 1, 0, 1);
    const [pdn, pr] = await Promise.all([
      prisma.sapPurchaseDeliveryNote.aggregate({
        where: { docDate: { gte: start, lt: end }, cancelled: false },
        _sum: { docTotal: true },
        _count: { docEntry: true },
      }),
      prisma.sapPurchaseReturn.aggregate({
        where: { docDate: { gte: start, lt: end }, cancelled: false },
        _sum: { docTotal: true },
        _count: { docEntry: true },
      }),
    ]);
    const ach = pdn._sum.docTotal ?? 0;
    const ret = pr._sum.docTotal ?? 0;
    console.log(`  ${y} : Achats ${ach.toLocaleString("fr-FR", { maximumFractionDigits: 0 })} − retours ${ret.toLocaleString("fr-FR", { maximumFractionDigits: 0 })} = NET ${(ach - ret).toLocaleString("fr-FR", { maximumFractionDigits: 0 })} € · ${pdn._count.docEntry} PDN, ${pr._count.docEntry} retours`);
  }

  console.log("\n📦 Volume BL (Orders) par année :");
  for (const y of [2024, 2025, 2026]) {
    const start = new Date(y, 0, 1);
    const end = new Date(y + 1, 0, 1);
    const agg = await prisma.sapOrder.aggregate({
      where: { docDate: { gte: start, lt: end }, cancelled: false },
      _sum: { docTotal: true },
      _count: { docEntry: true },
    });
    const ca = agg._sum.docTotal ?? 0;
    console.log(`  ${y} : ${ca.toLocaleString("fr-FR", { maximumFractionDigits: 0 })} € · ${agg._count.docEntry} BL`);
  }
}

// ─────────────────────────────────────────────────────────────
// MAIN
// ─────────────────────────────────────────────────────────────
async function main() {
  console.log("═".repeat(60));
  console.log("  SMOKE PILOTAGE — POST SAP réel + backfill mirror");
  console.log("═".repeat(60));
  console.log(`  Mode: ${POST_ONLY ? "POST seul" : BACKFILL_ONLY ? "Backfill seul" : "POST + Backfill"}`);
  console.log(`  Backfill depuis: ${FROM}`);

  await login();

  let postedSummary = { orders: [], pdns: [] };
  if (!BACKFILL_ONLY) {
    postedSummary = await postSmokeBL();
  }

  if (!POST_ONLY) {
    console.log("\n" + "─".repeat(60));
    console.log(`PHASE 2 — Backfill mirror depuis ${FROM}`);
    console.log("─".repeat(60));
    const slpMap = await backfillBPs();
    // PDN d'abord pour alimenter priceMap (lot → prix d'achat réel).
    await backfillPdns();
    console.log(`\n  ℹ️  priceMap construit : ${priceMap.size} couples (item|lot) → prix`);
    // Invoices + Orders consomment priceMap pour calculer la vraie marge ligne.
    await backfillSalesDocs("Invoices", slpMap);
    await backfillSalesDocs("Orders", slpMap);
    // Avoirs clients (annulent du CA) + Retours fournisseurs (annulent du PDN).
    await backfillCreditNotes(slpMap);
    await backfillPurchaseReturns();
    console.log(`\n  📊 Qualité résolution lineCost :`);
    console.log(`     Lot exact (utilisé tel quel)         : ${priceMapHits.toLocaleString("fr-FR")} lignes`);
    console.log(`     Pas de lot/EM0000 → dernier prix     : ${priceMapLastBefore.toLocaleString("fr-FR")} lignes (avant docDate)`);
    console.log(`     Pas de prix avant → premier connu    : ${priceMapAnyKnown.toLocaleString("fr-FR")} lignes (meilleur effort)`);
    console.log(`     Fallback StockPrice                  : ${priceMapFallbacks.toLocaleString("fr-FR")} lignes`);
    console.log(`     Non résolu (null)                    : ${priceMapNulls.toLocaleString("fr-FR")} lignes`);
    const totalRes = priceMapHits + priceMapLastBefore + priceMapAnyKnown + priceMapFallbacks + priceMapNulls;
    const exactPct = totalRes > 0 ? (priceMapHits * 100 / totalRes).toFixed(1) : "0";
    const histPct = totalRes > 0 ? ((priceMapLastBefore + priceMapAnyKnown) * 100 / totalRes).toFixed(1) : "0";
    console.log(`     → ${exactPct}% lot exact, ${histPct}% par historique prix`);
    await updateCursor();
  }

  await logout();

  if (!POST_ONLY) await reportFinalCounts();

  if (postedSummary.orders.length > 0 || postedSummary.pdns.length > 0) {
    console.log("\n" + "═".repeat(60));
    console.log("🆕 Docs créés dans SAP cette exécution :");
    console.log("═".repeat(60));
    for (const o of postedSummary.orders) console.log(`  Order   #${o.docNum} (DocEntry ${o.docEntry}) — ${o.card}, ${o.nLines}L, ${r2(o.total ?? 0)}€`);
    for (const p of postedSummary.pdns) console.log(`  PDN     #${p.docNum} (DocEntry ${p.docEntry}) — ${p.vendor}, ${p.nLines}L, ${r2(p.total ?? 0)}€`);
    console.log(`\n  ℹ️  Annulation par filter NumAtCard contains "SMOKE-PILOTAGE"`);
  }

  console.log("\n✅ Smoke pilotage terminé.");
}

main()
  .catch((e) => { console.error("❌ Erreur:", e); process.exit(1); })
  .finally(async () => { try { await prisma.$disconnect(); } catch {} });
