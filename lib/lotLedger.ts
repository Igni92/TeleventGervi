/**
 * REGISTRE DES LOTS — maintenu par TeleVent.
 *
 * Le stock PAR LOT n'existe pas dans le Service Layer de cette base SAP (seul le
 * stock par ARTICLE est exposé). On le tient donc nous-mêmes dans la table
 * `ProductBatch` (colonne `quantity`), au repère « EM<DocNum> » = le bon de
 * réception (PurchaseDeliveryNote) d'origine du lot — exactement le lot posé sur
 * les BL (U_NoLot) et à la réception.
 *
 *   • CRÉDIT à la RÉCEPTION (entrée marchandise) : quantité reçue + fournisseur
 *     + prix d'achat mémorisés sur le lot.
 *   • DÉBIT à la VENTE (commande) : la quantité vendue est retirée du lot affecté.
 *
 * Clé unique : (productId, batchNumber="EM<DocNum>", warehouseCode="") — UN lot =
 * UNE ligne, quantité AGRÉGÉE tous entrepôts (cohérent avec la synchro, qui pose
 * warehouseCode=""). La synchro produits n'écrit JAMAIS `quantity` (elle ne fait
 * qu'alimenter DLC/statut/prix/fournisseur), donc ce registre n'est pas écrasé.
 *
 * ⚠️ TOUT est best-effort : une erreur de registre NE DOIT JAMAIS bloquer une
 * vente ni une réception. Les appelants encapsulent déjà dans un try/catch.
 */
import { prisma } from "@/lib/prisma";
import { isRealLot } from "@/lib/gervifrais-calc";

// Ré-export : les consommateurs du registre (bons-commande…) importent isRealLot
// depuis ce module. La définition PURE vit dans gervifrais-calc (testable sans Prisma).
export { isRealLot };

/** Registre agrégé : une seule ligne par lot, entrepôt neutralisé. */
const LEDGER_WHS = "";

export interface LotCredit {
  itemCode: string;
  lot: string;                     // "EM<DocNum>"
  qty: number;                     // quantité reçue (unité SAP : pie/kg)
  supplierName?: string | null;
  purchasePrice?: number | null;   // €/unité SAP
  currency?: string | null;
  sourceDocNum?: string | null;    // n° du BR (traçabilité)
  admissionDate?: Date | null;
}

/** Métadonnées fournisseur/prix à écrire (uniquement les valeurs renseignées). */
function creditMeta(c: LotCredit): Record<string, unknown> {
  const m: Record<string, unknown> = {};
  if (c.supplierName?.trim()) m.supplierName = c.supplierName.trim();
  if (c.purchasePrice != null && c.purchasePrice > 0) m.purchasePrice = c.purchasePrice;
  if (c.currency?.trim()) m.currency = c.currency.trim();
  if (c.sourceDocNum?.trim()) m.sourceDocNum = c.sourceDocNum.trim();
  if (c.admissionDate) m.admissionDate = c.admissionDate;
  return m;
}

/**
 * CRÉDIT de lots (réception) : `quantity += reçu`, méta fournisseur/prix posées.
 * Résout les productId en 1 requête. Renvoie le nombre de lots crédités.
 */
export async function creditLots(credits: LotCredit[]): Promise<number> {
  const valid = credits.filter((c) => isRealLot(c.lot) && c.qty > 0);
  if (valid.length === 0) return 0;

  const codes = [...new Set(valid.map((c) => c.itemCode))];
  const prods = await prisma.product.findMany({ where: { itemCode: { in: codes } }, select: { id: true, itemCode: true } });
  const idByCode = new Map(prods.map((p) => [p.itemCode, p.id]));

  let n = 0;
  for (const c of valid) {
    const productId = idByCode.get(c.itemCode);
    if (!productId) continue;
    const meta = creditMeta(c);
    try {
      await prisma.productBatch.upsert({
        where: { productId_batchNumber_warehouseCode: { productId, batchNumber: c.lot, warehouseCode: LEDGER_WHS } },
        update: { quantity: { increment: c.qty }, syncedAt: new Date(), ...meta },
        create: { productId, batchNumber: c.lot, warehouseCode: LEDGER_WHS, quantity: c.qty, ...meta },
      });
      n++;
    } catch { /* best-effort : un lot en échec n'interrompt pas les autres */ }
  }
  return n;
}

/**
 * Lot FIFO EN STOCK par article, d'après le REGISTRE (le plus vieux lot encore
 * `quantity > 0`). Sert de REPLI de résolution à la vente quand le résolveur PDN
 * est aveugle — typiquement un produit FABRIQUÉ (lot OP<NNNNN>, jamais reçu par
 * un bon de réception) ou un article suivi uniquement au registre. « Pas de stock
 * → pas de lot » : un article sans lot au registre > 0 est absent de la map.
 */
export async function getLedgerFifoLot(itemCodes: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const codes = [...new Set(itemCodes.filter(Boolean))];
  if (codes.length === 0) return out;
  try {
    const rows = await prisma.$queryRawUnsafe<{ itemCode: string; batchNumber: string }[]>(
      `SELECT DISTINCT ON (p."itemCode") p."itemCode", b."batchNumber"
         FROM "ProductBatch" b
         JOIN "Product" p ON p."id" = b."productId"
        WHERE p."itemCode" = ANY($1::text[]) AND b."quantity" > 0
        ORDER BY p."itemCode", b."admissionDate" ASC NULLS LAST, b."batchNumber" ASC;`,
      codes,
    );
    for (const r of rows) if (isRealLot(r.batchNumber)) out.set(r.itemCode, r.batchNumber);
  } catch { /* registre indisponible → aucune résolution de repli */ }
  return out;
}

/**
 * DÉBIT de lots (vente) : `quantity -= vendu`, plancher 0. Les quantités d'un
 * même lot réparties sur plusieurs lignes sont cumulées. Un lot inconnu du
 * registre (reçu avant l'activation, ou hors TeleVent) est ignoré — on ne
 * fabrique pas de solde négatif. Renvoie le nombre de lots débités.
 */
export async function debitLots(debits: { itemCode: string; lot: string; qty: number }[]): Promise<number> {
  const valid = debits.filter((d) => isRealLot(d.lot) && d.qty > 0);
  if (valid.length === 0) return 0;

  const codes = [...new Set(valid.map((d) => d.itemCode))];
  const prods = await prisma.product.findMany({ where: { itemCode: { in: codes } }, select: { id: true, itemCode: true } });
  const idByCode = new Map(prods.map((p) => [p.itemCode, p.id]));

  // Cumule par (productId, lot) — plusieurs lignes peuvent viser le même lot.
  const byKey = new Map<string, { productId: string; lot: string; qty: number }>();
  for (const d of valid) {
    const productId = idByCode.get(d.itemCode);
    if (!productId) continue;
    const key = `${productId}|${d.lot}`;
    const cur = byKey.get(key);
    if (cur) cur.qty += d.qty; else byKey.set(key, { productId, lot: d.lot, qty: d.qty });
  }

  let n = 0;
  for (const { productId, lot, qty } of byKey.values()) {
    try {
      const row = await prisma.productBatch.findUnique({
        where: { productId_batchNumber_warehouseCode: { productId, batchNumber: lot, warehouseCode: LEDGER_WHS } },
        select: { id: true, quantity: true },
      });
      if (!row) continue;   // lot hors registre → rien à débiter
      const next = Math.max(0, Math.round((row.quantity - qty) * 1000) / 1000);
      await prisma.productBatch.update({ where: { id: row.id }, data: { quantity: next } });
      n++;
    } catch { /* best-effort */ }
  }
  return n;
}
