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

/** Prix d'achat unitaire (€/unité d'inventaire) = ligne du dernier PDN non annulé. */
async function purchaseUnitPrice(itemCode: string): Promise<number> {
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
 * Construit le PLAN de régularisation (aucune écriture) : un mouvement par ligne
 * d'écart non nul, écart converti colis → unités SAP, lot EM et valorisation.
 */
export async function computeAdjustmentPlan(session: InventorySession): Promise<InventoryMove[]> {
  const ecartLines = session.lines.filter((l) => Math.abs(l.ecart) > EPS);
  if (ecartLines.length === 0) return [];

  // Lot maps (1 scan SAP, caché 10 min) — best-effort : null si SAP indispo.
  let maps: Awaited<ReturnType<typeof getLotMaps>> | null = null;
  try { maps = await getLotMaps(); } catch { maps = null; }

  const moves: InventoryMove[] = [];
  for (const l of ecartLines) {
    const product = await prisma.product.findUnique({
      where: { itemCode: l.itemCode },
      select: { salesUnit: true, salesQtyPerPackUnit: true, salesUnitWeight: true },
    });
    const unitsPerColis = colisInfo({
      salesUnit: product?.salesUnit ?? null,
      salesQtyPerPackUnit: product?.salesQtyPerPackUnit ?? null,
      salesUnitWeight: product?.salesUnitWeight ?? null,
    }).unitsPerColis;

    // l.ecart est en COLIS (comptage préparateur) → unités d'inventaire SAP.
    const ecartUnits = round2(l.ecart * unitsPerColis);
    if (Math.abs(ecartUnits) < EPS) continue;

    const lot = maps ? resolveLotDetailed(maps, l.itemCode, WAREHOUSE).lot : null;
    const unitPrice = await purchaseUnitPrice(l.itemCode);
    const qtyUnits = Math.abs(ecartUnits);
    moves.push({
      itemCode: l.itemCode,
      itemName: l.itemName,
      sens: ecartUnits > 0 ? "entree" : "sortie",
      ecartColis: l.ecart,
      unitsPerColis,
      qtyUnits,
      lot,
      unitPrice,
      value: round2(qtyUnits * unitPrice),
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
  const DocumentLines = moves.map((m) => {
    const line: Record<string, unknown> = {
      ItemCode: m.itemCode,
      Quantity: m.qtyUnits,
      WarehouseCode: WAREHOUSE,
    };
    if (manageBatch.get(m.itemCode) && m.lot) {
      line.BatchNumbers = [{ BatchNumber: m.lot, Quantity: m.qtyUnits }];
    }
    return line;
  });

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
      await applyInventoryDelta(sorties.map((m) => ({ itemCode: m.itemCode, deltaUnits: -m.qtyUnits, warehouseCode: WAREHOUSE })));
    } catch (e) {
      return { ...base, status: "error", error: `Sortie SAP échouée : ${(e as Error).message}` };
    }
  }

  // 2) ENTRÉE des excédents (après la sortie, comme la fabrication).
  if (entrees.length > 0) {
    try {
      const entry = await postDoc("/InventoryGenEntries", "InventoryGenEntries", entrees, manageBatch, comments, docDate);
      base.sapEntryDocNum = entry.DocNum; base.sapEntryEntry = entry.DocEntry;
      await applyInventoryDelta(entrees.map((m) => ({ itemCode: m.itemCode, deltaUnits: m.qtyUnits, warehouseCode: WAREHOUSE })));
    } catch (e) {
      return { ...base, status: "error", error: `Entrée SAP échouée APRÈS sortie OK (exit#${base.sapExitDocNum ?? "—"}) : ${(e as Error).message}` };
    }
  }

  return base;
}
