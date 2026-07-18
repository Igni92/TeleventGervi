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
 *   • ÉCRÊTAGE au STOCK PHYSIQUE (synchro produits) : la somme des lots d'un
 *     article ne dépasse jamais son stock physique — le surplus fantôme (dérive,
 *     ventes SAP directes) est retiré des lots les plus anciens
 *     (reconcileLedgerToPhysical). Chaque mouvement pose `ledgerAt` (garde
 *     anti-course de l'écrêtage).
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
import { isRealLot, planLedgerTrim } from "@/lib/gervifrais-calc";

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
        update: { quantity: { increment: c.qty }, syncedAt: new Date(), ledgerAt: new Date(), ...meta },
        create: { productId, batchNumber: c.lot, warehouseCode: LEDGER_WHS, quantity: c.qty, ledgerAt: new Date(), ...meta },
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
 * ÉCRÊTAGE du registre au STOCK PHYSIQUE — la somme des lots d'un article ne peut
 * pas dépasser son stock physique (miroir `ProductStock.inStock`, entrepôts
 * télévente). Quand elle le dépasse (dérive historique, ventes passées directement
 * dans SAP jamais débitées ici), le surplus fantôme est retiré des lots les PLUS
 * ANCIENS (FIFO — cf. `planLedgerTrim`, pur & testé). N'écrit JAMAIS à la hausse :
 * un registre ≤ stock (lots affectés pas encore livrés, etc.) est laissé tel quel.
 *
 * Garde ANTI-COURSE : un article dont un lot a bougé (`ledgerAt`) il y a moins de
 * `quietMinutes` (défaut 60) est SAUTÉ — une réception/vente en cours peut devancer
 * le miroir de stock, on réconcilie au passage suivant. Appelé par la synchro
 * produits (toutes les 30 min, juste après le rafraîchissement de `ProductStock`)
 * et par `scripts/reconcile-lot-ledger.mjs`. Best-effort, comme tout le registre.
 */
export async function reconcileLedgerToPhysical(
  opts?: { quietMinutes?: number },
): Promise<{ articles: number; lots: number; trimmedQty: number }> {
  const quietMs = (opts?.quietMinutes ?? 60) * 60_000;
  const res = { articles: 0, lots: 0, trimmedQty: 0 };
  try {
    const rows = await prisma.$queryRawUnsafe<{
      id: string; productId: string; quantity: number; admissionDate: Date | null;
      batchNumber: string; ledgerAt: Date | null; physical: number;
    }[]>(
      `SELECT b."id", b."productId", b."quantity", b."admissionDate", b."batchNumber", b."ledgerAt",
              COALESCE(s."stock", 0)::float8 AS "physical"
         FROM "ProductBatch" b
         LEFT JOIN (SELECT "productId", SUM("inStock") AS "stock"
                      FROM "ProductStock" GROUP BY "productId") s
           ON s."productId" = b."productId"
        WHERE b."quantity" > 0;`,
    );

    const byProduct = new Map<string, typeof rows>();
    for (const r of rows) {
      const g = byProduct.get(r.productId);
      if (g) g.push(r); else byProduct.set(r.productId, [r]);
    }

    const now = Date.now();
    for (const lots of byProduct.values()) {
      const physical = lots[0].physical;
      const total = lots.reduce((s, l) => s + l.quantity, 0);
      if (total <= physical + 1e-6) continue;                    // registre ≤ stock : sain
      if (lots.some((l) => l.ledgerAt && now - new Date(l.ledgerAt).getTime() < quietMs)) continue;
      const trims = planLedgerTrim(lots, physical);
      if (trims.length === 0) continue;
      try {
        for (const t of trims) {
          await prisma.productBatch.update({ where: { id: t.lot.id }, data: { quantity: t.quantity } });
        }
        res.articles++;
        res.lots += trims.length;
        res.trimmedQty += trims.reduce((s, t) => s + (t.lot.quantity - t.quantity), 0);
      } catch { /* best-effort : article suivant */ }
    }
    res.trimmedQty = Math.round(res.trimmedQty * 1000) / 1000;
  } catch { /* registre/stock indisponible (ou colonne ledgerAt absente) → aucun écrêtage */ }
  return res;
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
      await prisma.productBatch.update({ where: { id: row.id }, data: { quantity: next, ledgerAt: new Date() } });
      n++;
    } catch { /* best-effort */ }
  }
  return n;
}
