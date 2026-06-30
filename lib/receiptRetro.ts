/**
 * Propagation rétro d'une entrée marchandise (EM) sur les ventes/sorties à
 * découvert — choix du MAGASIN à affecter, par (article × magasin).
 *
 * Problème corrigé : une commande vendue à découvert porte un magasin choisi à la
 * saisie. Quand l'EM qui la couvre arrive dans un AUTRE magasin, propager le seul
 * lot `EM<DocNum>` sans déplacer la ligne laisse celle-ci sur un magasin sans
 * stock → « stock dispo négatif ». Règle métier : le lot doit AUSSI déplacer le
 * magasin vers celui où l'EM a été réceptionnée.
 *
 * Ces fonctions sont PURES (aucun appel SAP/Prisma) pour être testées isolément ;
 * la route /api/sap/goods-receipts les pilote.
 */

/** Budget de couverture restant : article → (magasin → quantité en pie). */
export type WhsBudget = Map<string, Map<string, number>>;

/** Construit le budget des quantités reçues par (article × magasin). */
export function buildWhsBudget(
  lines: { itemCode: string; warehouseCode: string; pieceQty: number }[],
): WhsBudget {
  const m: WhsBudget = new Map();
  for (const l of lines) {
    if (!l.itemCode || !l.warehouseCode || !(l.pieceQty > 0)) continue;
    let byWhs = m.get(l.itemCode);
    if (!byWhs) {
      byWhs = new Map();
      m.set(l.itemCode, byWhs);
    }
    byWhs.set(l.warehouseCode, (byWhs.get(l.warehouseCode) ?? 0) + l.pieceQty);
  }
  return m;
}

/** Reliquat total pour un article, tous magasins de réception confondus. */
export function remainingForItem(budget: WhsBudget, itemCode: string): number {
  const byWhs = budget.get(itemCode);
  if (!byWhs) return 0;
  let s = 0;
  for (const v of byWhs.values()) s += v;
  return s;
}

/**
 * Choisit le magasin de réception à affecter à une ligne à découvert :
 *   1. le magasin ACTUEL de la ligne s'il a reçu du stock (reliquat > 0) — on
 *      évite un déplacement inutile ;
 *   2. sinon le magasin de réception au plus gros reliquat ;
 *   3. `null` si aucun magasin de cette EM n'a de reliquat pour l'article.
 */
export function pickReceiptWarehouse(
  budget: WhsBudget,
  itemCode: string,
  currentWarehouse: string | null | undefined,
): string | null {
  const byWhs = budget.get(itemCode);
  if (!byWhs) return null;
  if (currentWarehouse && (byWhs.get(currentWarehouse) ?? 0) > 0) return currentWarehouse;
  let best: string | null = null;
  let bestRem = 0;
  for (const [whs, rem] of byWhs) {
    if (rem > bestRem) {
      best = whs;
      bestRem = rem;
    }
  }
  return best;
}

/** Décrémente le budget (article, magasin) de la quantité couverte (jamais < 0). */
export function consumeBudget(budget: WhsBudget, itemCode: string, warehouse: string, qty: number): void {
  const byWhs = budget.get(itemCode);
  if (!byWhs) return;
  byWhs.set(warehouse, Math.max(0, (byWhs.get(warehouse) ?? 0) - (qty > 0 ? qty : 0)));
}
