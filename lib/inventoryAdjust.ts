/**
 * Régularisation de stock SAP à partir d'un inventaire validé.
 *
 * À la validation par un admin/direction, chaque écart compté (en COLIS) est
 * converti en unités d'inventaire SAP puis posté :
 *   • manque  (réel < SAP) → SORTIE  de stock  (InventoryGenExits)
 *   • excédent(réel > SAP) → ENTRÉE  de stock  (InventoryGenEntries)
 * avec le lot EM<DocNum> de la dernière réception (FIFO, lotResolver), une
 * valorisation au prix d'achat (dernier PDN), et mise à jour du miroir local.
 *
 * ⚠️ Écrit dans la base SAP ACTIVE (prod/test). Idempotent : une session déjà
 * « adjusted » (adjustment.status === "done") ne peut pas être re-postée.
 */
import { prisma } from "@/lib/prisma";
import { sap } from "@/lib/sapb1";
import { colisInfo } from "@/lib/colis";
import { getLotMaps, resolveLotDetailed } from "@/lib/lotResolver";
import { applyInventoryDelta } from "@/lib/stockSync";
import type { InventoryMove, InventoryAdjustment, InventorySession } from "@/lib/inventory";

/** Entrepôt physique régularisé (stock comptable). */
const WAREHOUSE = "01";
/** Seuil sous lequel un écart converti en unités SAP est ignoré (bruit d'arrondi). */
const EPS = 0.001;

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Prix d'achat unitaire (€/unité d'inventaire) — basé sur l'ENTRÉE MARCHANDISE.
 * 1) Prix de l'EM EXACTE du lot sorti/entré (lot = « EM<DocNum> ») : c'est la
 *    marchandise qu'on bouge → on la valorise à SON prix d'achat réel.
 * 2) Repli : dernière EM non annulée de l'article (si le lot n'a pas de ligne).
 */
async function purchaseUnitPrice(itemCode: string, lot: string | null): Promise<number> {
  const docNum = lot ? /^EM(\d+)$/.exec(lot)?.[1] : undefined;
  if (docNum) {
    try {
      const rows = await prisma.$queryRawUnsafe<{ unitCost: number | null }[]>(
        `SELECT (em."lineTotal" / NULLIF(em."quantity", 0))::float8 AS "unitCost"
           FROM "SapPdnLine" em
           JOIN "SapPurchaseDeliveryNote" h ON h."docEntry" = em."docEntry"
          WHERE h."docNum" = $1 AND em."itemCode" = $2 AND em."quantity" > 0
          ORDER BY em."lineNum" ASC
          LIMIT 1`,
        Number(docNum), itemCode,
      );
      const c = rows[0]?.unitCost;
      if (c != null && Number.isFinite(c) && c > 0) return round2(c);
    } catch { /* repli ci-dessous */ }
  }
  try {
    const rows = await prisma.$queryRawUnsafe<{ unitCost: number | null }[]>(
      `SELECT (em."lineTotal" / NULLIF(em."quantity", 0))::float8 AS "unitCost"
         FROM "SapPdnLine" em
         JOIN "SapPurchaseDeliveryNote" h ON h."docEntry" = em."docEntry"
        WHERE em."itemCode" = $1 AND em."quantity" > 0 AND h."cancelled" = false
        ORDER BY h."docDate" DESC, h."docEntry" DESC
        LIMIT 1`,
      itemCode,
    );
    const c = rows[0]?.unitCost;
    return c != null && Number.isFinite(c) && c > 0 ? round2(c) : 0;
  } catch {
    return 0;
  }
}

/**
 * Répartit une quantité (unités SAP) sur les entrepôts 000/01/R1 d'après le stock
 * miroir — pour ne JAMAIS poster une sortie sur un entrepôt qui n'a pas la
 * marchandise (cause de l'échec « quantité insuffisante »). SORTIE : on prend là
 * où il y a du stock (le plus fourni d'abord). ENTRÉE : on consolide sur
 * l'entrepôt déjà le plus fourni, sinon l'entrepôt physique 01.
 */
function allocateWarehouses(
  sens: "entree" | "sortie",
  stocks: { warehouse: string; inStock: number }[],
  qty: number,
): { warehouse: string; qtyUnits: number }[] {
  const withStock = stocks.filter((s) => s.inStock > EPS).sort((a, b) => b.inStock - a.inStock);
  if (sens === "entree") {
    return [{ warehouse: withStock[0]?.warehouse ?? WAREHOUSE, qtyUnits: round2(qty) }];
  }
  const out: { warehouse: string; qtyUnits: number }[] = [];
  let remaining = qty;
  for (const s of withStock) {
    if (remaining <= EPS) break;
    const take = Math.min(remaining, s.inStock);
    out.push({ warehouse: s.warehouse, qtyUnits: round2(take) });
    remaining = round2(remaining - take);
  }
  // Reliquat (stock miroir insuffisant) → on le pose sur l'entrepôt le plus fourni
  // (ou 01) ; SAP tranchera, mais on n'est jamais pire que l'ancien « tout sur 01 ».
  if (remaining > EPS) {
    const wh = withStock[0]?.warehouse ?? WAREHOUSE;
    const ex = out.find((o) => o.warehouse === wh);
    if (ex) ex.qtyUnits = round2(ex.qtyUnits + remaining);
    else out.push({ warehouse: wh, qtyUnits: round2(remaining) });
  }
  return out.length > 0 ? out : [{ warehouse: WAREHOUSE, qtyUnits: round2(qty) }];
}

/**
 * Construit le PLAN de régularisation (aucune écriture) : un mouvement par ligne
 * d'écart non nul, écart converti colis → unités SAP, lot EM et valorisation.
 */
export async function computeAdjustmentPlan(session: InventorySession): Promise<InventoryMove[]> {
  const ecartLines = session.lines.filter((l) => Math.abs(l.ecart) > EPS);
  if (ecartLines.length === 0) return [];

  // Lot maps (1 scan SAP, caché 10 min) — best-effort : null si SAP indispo.
  let maps: Awaited<ReturnType<typeof getLotMaps>> | null = null;
  try { maps = await getLotMaps(); } catch { maps = null; }

  const codes = Array.from(new Set(ecartLines.map((l) => l.itemCode)));

  // Désignation + unités (raw : les champs U_* ne sont pas dans le client Prisma typé).
  type ProdRow = {
    itemCode: string; salesUnit: string | null; salesQtyPerPackUnit: number | null; salesUnitWeight: number | null;
    uPays: string | null; uMarque: string | null; uCondi: string | null; frgnName: string | null;
  };
  const prodRows = await prisma.$queryRawUnsafe<ProdRow[]>(
    `SELECT "itemCode","salesUnit","salesQtyPerPackUnit","salesUnitWeight","uPays","uMarque","uCondi","frgnName"
       FROM "Product" WHERE "itemCode" = ANY($1::text[])`,
    codes,
  );
  const prodByCode = new Map(prodRows.map((p) => [p.itemCode, p]));

  // Stock PAR ENTREPÔT (miroir) — pour VÉRIFIER les magasins avant tout mouvement.
  type StockRow = { itemCode: string; warehouse: string; inStock: number };
  const stockRows = await prisma.$queryRawUnsafe<StockRow[]>(
    `SELECT p."itemCode", s."warehouse", s."inStock"
       FROM "ProductStock" s JOIN "Product" p ON p."id" = s."productId"
      WHERE p."itemCode" = ANY($1::text[]) AND s."warehouse" IN ('000','01','R1')`,
    codes,
  );
  const stockByCode = new Map<string, { warehouse: string; inStock: number }[]>();
  for (const r of stockRows) {
    const arr = stockByCode.get(r.itemCode) ?? [];
    arr.push({ warehouse: r.warehouse, inStock: Number(r.inStock) || 0 });
    stockByCode.set(r.itemCode, arr);
  }

  const moves: InventoryMove[] = [];
  for (const l of ecartLines) {
    const product = prodByCode.get(l.itemCode);
    const unitsPerColis = colisInfo({
      salesUnit: product?.salesUnit ?? null,
      salesQtyPerPackUnit: product?.salesQtyPerPackUnit ?? null,
      salesUnitWeight: product?.salesUnitWeight ?? null,
    }).unitsPerColis;

    // l.ecart est en COLIS (comptage préparateur) → unités d'inventaire SAP.
    const ecartUnits = round2(l.ecart * unitsPerColis);
    if (Math.abs(ecartUnits) < EPS) continue;
    const qtyUnits = Math.abs(ecartUnits);
    const sens: "entree" | "sortie" = ecartUnits > 0 ? "entree" : "sortie";

    // Répartition entrepôts VÉRIFIÉE, avec le lot résolu POUR CHAQUE entrepôt
    // (batch × magasin cohérents → la sortie ne tape jamais le mauvais magasin).
    const alloc = allocateWarehouses(sens, stockByCode.get(l.itemCode) ?? [], qtyUnits);
    const warehouses = alloc.map((a) => ({
      warehouse: a.warehouse,
      qtyUnits: a.qtyUnits,
      lot: maps ? resolveLotDetailed(maps, l.itemCode, a.warehouse).lot : null,
    }));
    const primaryLot = warehouses[0]?.lot ?? (maps ? resolveLotDetailed(maps, l.itemCode, WAREHOUSE).lot : null);

    // Prix basé sur l'EM du lot bougé (« base toi sur l'entrée marchandise »).
    const unitPrice = await purchaseUnitPrice(l.itemCode, primaryLot);
    moves.push({
      itemCode: l.itemCode,
      itemName: l.itemName,
      sens,
      ecartColis: l.ecart,
      unitsPerColis,
      qtyUnits,
      lot: primaryLot,
      unitPrice,
      value: round2(qtyUnits * unitPrice),
      uPays: product?.uPays ?? null,
      uMarque: product?.uMarque ?? null,
      uCondi: product?.uCondi ?? null,
      frgnName: product?.frgnName ?? null,
      warehouses,
    });
  }
  return moves;
}

/** Résumé chiffré d'un plan (réutilisé par l'aperçu et la trace). */
export function summarizeMoves(moves: InventoryMove[]) {
  return {
    nbSorties: moves.filter((m) => m.sens === "sortie").length,
    nbEntrees: moves.filter((m) => m.sens === "entree").length,
    totalValue: round2(moves.reduce((s, m) => s + (m.sens === "entree" ? m.value : -m.value), 0)),
    // Démarque inconnue = valeur des manques (sorties), en positif.
    demarqueValue: round2(moves.filter((m) => m.sens === "sortie").reduce((s, m) => s + m.value, 0)),
  };
}

type SapDoc = { DocEntry: number; DocNum: number };

/**
 * Poste UN document SAP (entrée ou sortie) pour un sous-ensemble de mouvements.
 * Lot : BatchNumbers si l'article est géré par lot, sinon U_NoLot via PATCH
 * (traçabilité, même convention que /api/sap/orders). Renvoie le DocEntry/DocNum.
 */
async function postDoc(
  endpoint: "/InventoryGenExits" | "/InventoryGenEntries",
  entity: "InventoryGenExits" | "InventoryGenEntries",
  moves: InventoryMove[],
  manageBatch: Map<string, boolean>,
  comments: string,
  docDate: string,
): Promise<SapDoc> {
  // Une ligne PAR (article × entrepôt) selon la répartition vérifiée — la sortie
  // est prélevée là où la marchandise est RÉELLEMENT présente, avec le lot de cet
  // entrepôt pour les articles gérés par lot.
  const DocumentLines: Record<string, unknown>[] = [];
  for (const m of moves) {
    const allocs = m.warehouses && m.warehouses.length > 0
      ? m.warehouses
      : [{ warehouse: WAREHOUSE, qtyUnits: m.qtyUnits, lot: m.lot }];
    for (const a of allocs) {
      if (a.qtyUnits <= EPS) continue;
      const line: Record<string, unknown> = {
        ItemCode: m.itemCode,
        Quantity: a.qtyUnits,
        WarehouseCode: a.warehouse,
      };
      if (manageBatch.get(m.itemCode) && a.lot) {
        line.BatchNumbers = [{ BatchNumber: a.lot, Quantity: a.qtyUnits }];
      }
      DocumentLines.push(line);
    }
  }

  const doc = await sap.post<SapDoc>(endpoint, { DocDate: docDate, Comments: comments, DocumentLines });

  // Articles NON gérés par lot : on pose U_NoLot (EM<DocNum>) en PATCH après coup.
  const nonBatch = moves.filter((m) => !manageBatch.get(m.itemCode) && m.lot);
  if (nonBatch.length > 0) {
    try {
      const refetch = await sap.get<{ DocumentLines: { LineNum: number; ItemCode: string }[] }>(
        `${entity}(${doc.DocEntry})?$select=DocumentLines`,
      );
      const lotByItem = new Map(moves.map((m) => [m.itemCode, m.lot] as const));
      const patchLines = (refetch.DocumentLines || [])
        .filter((l) => lotByItem.get(l.ItemCode))
        .map((l) => ({ LineNum: l.LineNum, U_NoLot: lotByItem.get(l.ItemCode) }));
      if (patchLines.length > 0) {
        await sap.patch(`${entity}(${doc.DocEntry})`, { DocumentLines: patchLines });
      }
    } catch (e) {
      // Best-effort : le stock est déjà bougé, seule l'étiquette de lot manque.
      console.warn(`[inventoryAdjust] PATCH U_NoLot ${entity}(${doc.DocEntry}) échoué:`, (e as Error).message);
    }
  }
  return doc;
}

/**
 * Exécute la régularisation : poste la SORTIE (manques) puis l'ENTRÉE (excédents)
 * dans SAP, met à jour le miroir local et renvoie la trace. En cas d'échec partiel
 * (sortie OK, entrée KO), renvoie une trace `status:"error"` avec ce qui a été posté.
 */
export async function executeAdjustment(session: InventorySession, actor: string): Promise<InventoryAdjustment> {
  const moves = await computeAdjustmentPlan(session);
  const { nbSorties, nbEntrees, totalValue, demarqueValue } = summarizeMoves(moves);
  const env = sap.getEnvironment().env;
  const base: InventoryAdjustment = {
    status: "done", at: new Date().toISOString(), by: actor, moves,
    nbSorties, nbEntrees, totalValue, demarqueValue,
    sapExitDocNum: null, sapExitEntry: null, sapEntryDocNum: null, sapEntryEntry: null, sapEnv: env,
  };
  if (moves.length === 0) return base; // aucun écart → no-op

  // manageBatch par article (pour choisir BatchNumbers vs U_NoLot).
  const codes = Array.from(new Set(moves.map((m) => m.itemCode)));
  const prods = await prisma.product.findMany({ where: { itemCode: { in: codes } }, select: { itemCode: true, manageBatch: true } });
  const manageBatch = new Map<string, boolean>(prods.map((p) => [p.itemCode, p.manageBatch] as [string, boolean]));

  const docDate = new Date().toISOString().slice(0, 10);
  const comments = `Inventaire ${session.id} — régularisation (compté par ${session.createdBy}) — validé par ${actor}`.slice(0, 254);

  const sorties = moves.filter((m) => m.sens === "sortie");
  const entrees = moves.filter((m) => m.sens === "entree");

  // 1) SORTIE des manques.
  if (sorties.length > 0) {
    try {
      const exit = await postDoc("/InventoryGenExits", "InventoryGenExits", sorties, manageBatch, comments, docDate);
      base.sapExitDocNum = exit.DocNum; base.sapExitEntry = exit.DocEntry;
      await applyInventoryDelta(sorties.flatMap((m) =>
        (m.warehouses ?? [{ warehouse: WAREHOUSE, qtyUnits: m.qtyUnits, lot: m.lot }])
          .map((w) => ({ itemCode: m.itemCode, deltaUnits: -w.qtyUnits, warehouseCode: w.warehouse }))));
    } catch (e) {
      return { ...base, status: "error", error: `Sortie SAP échouée : ${(e as Error).message}` };
    }
  }

  // 2) ENTRÉE des excédents (après la sortie, comme la fabrication).
  if (entrees.length > 0) {
    try {
      const entry = await postDoc("/InventoryGenEntries", "InventoryGenEntries", entrees, manageBatch, comments, docDate);
      base.sapEntryDocNum = entry.DocNum; base.sapEntryEntry = entry.DocEntry;
      await applyInventoryDelta(entrees.flatMap((m) =>
        (m.warehouses ?? [{ warehouse: WAREHOUSE, qtyUnits: m.qtyUnits, lot: m.lot }])
          .map((w) => ({ itemCode: m.itemCode, deltaUnits: w.qtyUnits, warehouseCode: w.warehouse }))));
    } catch (e) {
      return { ...base, status: "error", error: `Entrée SAP échouée APRÈS sortie OK (exit#${base.sapExitDocNum ?? "—"}) : ${(e as Error).message}` };
    }
  }

  return base;
}
