import { prisma } from "./prisma";

/**
 * Stock DISPONIBLE par (article, entrepôt) depuis le miroir local `ProductStock`.
 *
 * ⚠️ Le stock PAR LOT n'existe PAS dans le Service Layer de cette base SAP
 * (cf. lib/lotLedger : la colonne `ProductBatch.quantity` n'est pas alimentée
 * par la synchro). La maille la plus fine FIABLE pour « ce lot a-t-il du stock
 * dans TeleVent ? » est donc l'article × entrepôt.
 *
 * On se base sur `available` (= inStock − committed, le DISPONIBLE réel) et non
 * sur `inStock` (stock physique) : un article dont tout le stock physique est
 * déjà réservé par des commandes est à découvert — proposer ses lots avec un
 * badge « N en stock » laissait croire qu'il restait de la marchandise
 * (demande opérateur du 16/07/2026). Les quantités restent en unités SAP ; la
 * conversion en COLIS et le seuil « ≥ 1 colis » sont appliqués par les routes,
 * qui connaissent le conditionnement de l'article (lib/colis).
 *
 * Un lot EM<DocNum> est reçu dans UN entrepôt donné ; on ne propose ce lot que
 * si cet entrepôt a effectivement du disponible pour l'article.
 */
export interface ItemStock {
  /** clé `${itemCode}|${warehouse}` → dispo (= stock − réservé, unité SAP). */
  byItemWhs: Map<string, number>;
  /** `itemCode` → dispo total (tous entrepôts confondus). */
  byItem: Map<string, number>;
}

export async function getItemStock(itemCodes: string[]): Promise<ItemStock> {
  const byItemWhs = new Map<string, number>();
  const byItem = new Map<string, number>();
  const codes = [...new Set(itemCodes.filter(Boolean))];
  if (codes.length === 0) return { byItemWhs, byItem };

  const rows = await prisma.productStock.findMany({
    where: { product: { itemCode: { in: codes } }, available: { gt: 0 } },
    select: { warehouse: true, available: true, product: { select: { itemCode: true } } },
  });
  for (const r of rows) {
    const code = r.product.itemCode;
    byItem.set(code, (byItem.get(code) ?? 0) + r.available);
    const key = `${code}|${r.warehouse}`;
    byItemWhs.set(key, (byItemWhs.get(key) ?? 0) + r.available);
  }
  return { byItemWhs, byItem };
}

/**
 * Un lot candidat est proposable si l'entrepôt où il a été reçu a AU MOINS
 * `minUnits` de disponible pour l'article — l'appelant passe les unités d'UN
 * colis pour appliquer la règle « pas de lot sous 1 colis de dispo » (défaut :
 * simple présence de dispo). Entrepôt inconnu → on retombe sur le total
 * article (mieux vaut proposer un lot plausible que rien).
 */
export function lotInStock(
  stock: ItemStock, itemCode: string, warehouse: string | null | undefined, minUnits = 0,
): boolean {
  const q = lotStockQty(stock, itemCode, warehouse);
  return minUnits > 0 ? q >= minUnits : q > 0;
}

/** Dispo attaché à un lot candidat (pour affichage) — 0 si épuisé/inconnu. */
export function lotStockQty(stock: ItemStock, itemCode: string, warehouse: string | null | undefined): number {
  if (warehouse) return stock.byItemWhs.get(`${itemCode}|${warehouse}`) ?? 0;
  return stock.byItem.get(itemCode) ?? 0;
}
