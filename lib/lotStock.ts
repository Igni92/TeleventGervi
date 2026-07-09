import { prisma } from "./prisma";

/**
 * STOCK PHYSIQUE par (article, entrepôt) depuis le miroir local `ProductStock`.
 *
 * ⚠️ Le stock PAR LOT n'existe PAS dans le Service Layer de cette base SAP
 * (cf. lib/lotLedger : la colonne `ProductBatch.quantity` n'est pas alimentée
 * par la synchro). La maille la plus fine FIABLE pour « ce lot a-t-il du stock
 * dans TeleVent ? » est donc l'article × entrepôt.
 *
 * On se base sur `inStock` (stock PHYSIQUE présent), pas sur `available`
 * (= inStock − committed) : un bon de commande à préparer porte sur la
 * marchandise réellement là, même si elle est déjà partiellement réservée.
 *
 * Un lot EM<DocNum> est reçu dans UN entrepôt donné ; on ne propose ce lot que
 * si cet entrepôt a effectivement du stock physique pour l'article.
 */
export interface ItemStock {
  /** clé `${itemCode}|${warehouse}` → stock physique (unité SAP). */
  byItemWhs: Map<string, number>;
  /** `itemCode` → stock physique total (tous entrepôts confondus). */
  byItem: Map<string, number>;
}

export async function getItemStock(itemCodes: string[]): Promise<ItemStock> {
  const byItemWhs = new Map<string, number>();
  const byItem = new Map<string, number>();
  const codes = [...new Set(itemCodes.filter(Boolean))];
  if (codes.length === 0) return { byItemWhs, byItem };

  const rows = await prisma.productStock.findMany({
    where: { product: { itemCode: { in: codes } }, inStock: { gt: 0 } },
    select: { warehouse: true, inStock: true, product: { select: { itemCode: true } } },
  });
  for (const r of rows) {
    const code = r.product.itemCode;
    byItem.set(code, (byItem.get(code) ?? 0) + r.inStock);
    const key = `${code}|${r.warehouse}`;
    byItemWhs.set(key, (byItemWhs.get(key) ?? 0) + r.inStock);
  }
  return { byItemWhs, byItem };
}

/**
 * Un lot candidat est « en stock TeleVent » si l'entrepôt où il a été reçu a du
 * stock physique pour l'article. Entrepôt inconnu → on retombe sur le total
 * article (mieux vaut proposer un lot plausible que rien).
 */
export function lotInStock(stock: ItemStock, itemCode: string, warehouse: string | null | undefined): boolean {
  if (warehouse) return (stock.byItemWhs.get(`${itemCode}|${warehouse}`) ?? 0) > 0;
  return (stock.byItem.get(itemCode) ?? 0) > 0;
}

/** Stock physique attaché à un lot candidat (pour affichage) — 0 si épuisé/inconnu. */
export function lotStockQty(stock: ItemStock, itemCode: string, warehouse: string | null | undefined): number {
  if (warehouse) return stock.byItemWhs.get(`${itemCode}|${warehouse}`) ?? 0;
  return stock.byItem.get(itemCode) ?? 0;
}
