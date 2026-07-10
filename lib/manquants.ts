/**
 * MANQUANTS — allocation du stock détenu aux commandes du jour.
 *
 * Principe métier (demandé par l'exploitation) : « faire d'abord avec ce que
 * l'on a, puis acheter les manquants ». Un article n'est un MANQUANT que si la
 * demande du jour dépasse le stock PHYSIQUE détenu (Items.QuantityOnStock, tous
 * entrepôts) — pas le « disponible SAP » global, qui inclut les engagements des
 * AUTRES jours et sur-comptait (ex. « 6 abricots » affichés en beaucoup plus).
 *
 * On ALLOUE ensuite le stock aux commandes dans un ordre de PRIORITÉ (réglable
 * par article) : les premières servies sont « complètes » avec le stock, le
 * reliquat non servi de chaque commande = « à acheter ». Le total à acheter d'un
 * article = max(0, demande − stock détenu).
 *
 * Fonctions PURES (testables hors React). L'I/O (fetch) vit dans le composant.
 *
 * ⚠️ Unité : la quantité de ligne (Order DocumentLines.Quantity) et le stock
 * (QuantityOnStock / QuantityOrderedByCustomers) sont exprimés dans la même
 * unité d'inventaire côté SAP — on les compare donc directement.
 */

import type { Carrier, Doc } from "./livraisonView";

/** Besoin d'UNE commande pour un article (avant allocation). */
export interface OrderNeed {
  docEntry: number;
  docNum: number;
  cardName: string;
  cardCode: string;
  carrierName: string | null;
  clientType: string | null;      // GMS | CHR | EXPORT | null
  takenAt: string | null;         // heure de prise (défaut de tri : premier arrivé)
  qty: number;                    // quantité demandée de l'article
  colis: number;                  // colis correspondants (info)
}

/** Besoin d'une commande APRÈS allocation du stock détenu. */
export interface AllocatedNeed extends OrderNeed {
  served: number;                 // servi par le stock détenu
  toBuy: number;                  // reliquat à acheter (qty − served)
}

/** Un article en manquant : demande du jour > stock détenu. */
export interface ItemShortage {
  itemCode: string;
  itemName: string;
  onHand: number;                 // stock physique détenu (tous entrepôts)
  demand: number;                 // total demandé le jour (commandes ouvertes, hors avoir)
  toBuy: number;                  // max(0, demand − onHand) — le VRAI manquant à acheter
  colis: number;                  // colis demandés (info)
  orders: AllocatedNeed[];        // commandes en ordre de priorité, avec allocation
}

/** Arrondi défensif (résidus flottants sur des quantités fractionnaires : kg). */
const r3 = (n: number) => Math.round(n * 1000) / 1000;

/** Un BL compte dans la demande s'il n'est ni un avoir/exclu ni déjà clôturé. */
function counts(d: Doc): boolean {
  return !d.excluded && d.open;
}

/** Tri par DÉFAUT des commandes : premier arrivé (heure de prise), repli n° de BL. */
function defaultCompare(a: OrderNeed, b: OrderNeed): number {
  const ta = a.takenAt ?? "";
  const tb = b.takenAt ?? "";
  if (ta && tb && ta !== tb) return ta < tb ? -1 : 1;
  if (ta && !tb) return -1;
  if (!ta && tb) return 1;
  return a.docNum - b.docNum;
}

/**
 * Allocation GLOUTONNE : sert les commandes dans l'ordre reçu jusqu'à épuiser le
 * stock détenu. Chaque commande servie prend le minimum entre son besoin et le
 * stock restant ; le reste de son besoin passe « à acheter ».
 */
export function allocate(onHand: number, orders: OrderNeed[]): AllocatedNeed[] {
  let remaining = Math.max(0, onHand);
  return orders.map((o) => {
    const served = r3(Math.min(o.qty, remaining));
    remaining = r3(remaining - served);
    return { ...o, served, toBuy: Math.max(0, r3(o.qty - served)) };
  });
}

/**
 * Construit la liste des articles MANQUANTS (demande du jour > stock détenu) avec
 * l'allocation du stock aux commandes. `priorityByItem` mappe un itemCode vers
 * l'ordre de priorité des `docEntry` (réglé à la main) ; à défaut, tri « premier
 * arrivé ». Les articles couverts par le stock ne sont PAS retournés.
 */
export function buildShortages(
  carriers: Carrier[],
  onHandStocks: Record<string, number> | undefined,
  priorityByItem: Record<string, number[]> = {},
): ItemShortage[] {
  if (!onHandStocks) return [];

  // Regroupe les besoins par article, sur les commandes qui comptent.
  const byItem = new Map<string, { itemName: string; onHand: number; needs: OrderNeed[] }>();
  for (const car of carriers) {
    for (const d of car.docs) {
      if (!counts(d)) continue;
      // Fusion défensive des lignes d'un même article dans le BL.
      const perItem = new Map<string, { qty: number; colis: number; name: string }>();
      for (const l of d.lines) {
        const g = perItem.get(l.itemCode) ?? { qty: 0, colis: 0, name: l.itemName };
        g.qty += l.quantity;
        g.colis += l.colis;
        perItem.set(l.itemCode, g);
      }
      for (const [itemCode, agg] of perItem) {
        const onHand = onHandStocks[itemCode];
        if (onHand === undefined) continue;   // stock inconnu → on ne juge pas cet article
        const e = byItem.get(itemCode) ?? { itemName: agg.name, onHand, needs: [] };
        e.needs.push({
          docEntry: d.docEntry,
          docNum: d.docNum,
          cardName: d.cardFullName ?? d.cardName,
          cardCode: d.cardCode,
          carrierName: d.carrierName,
          clientType: d.clientType,
          takenAt: d.takenAt ?? null,
          qty: agg.qty,
          colis: agg.colis,
        });
        byItem.set(itemCode, e);
      }
    }
  }

  const out: ItemShortage[] = [];
  for (const [itemCode, e] of byItem) {
    const demand = r3(e.needs.reduce((s, n) => s + n.qty, 0));
    const toBuy = Math.max(0, r3(demand - e.onHand));
    if (toBuy <= 0) continue;   // le stock détenu couvre la demande → pas un manquant

    // Ordre : priorité explicite de l'article d'abord, puis défaut « premier arrivé ».
    const rank = new Map<number, number>();
    (priorityByItem[itemCode] ?? []).forEach((de, i) => rank.set(de, i));
    const ordered = e.needs.slice().sort((a, b) => {
      const ra = rank.get(a.docEntry);
      const rb = rank.get(b.docEntry);
      if (ra !== undefined && rb !== undefined) return ra - rb;
      if (ra !== undefined) return -1;
      if (rb !== undefined) return 1;
      return defaultCompare(a, b);
    });

    out.push({
      itemCode,
      itemName: e.itemName,
      onHand: e.onHand,
      demand,
      toBuy,
      colis: r3(e.needs.reduce((s, n) => s + n.colis, 0)),
      orders: allocate(e.onHand, ordered),
    });
  }

  // Les plus gros manquants d'abord, puis alphabétique.
  out.sort((a, b) => b.toBuy - a.toBuy || a.itemName.localeCompare(b.itemName, "fr"));
  return out;
}

/**
 * Réordonne (d'un cran) une commande dans la priorité d'un article et renvoie la
 * NOUVELLE liste ordonnée complète des docEntry — à mémoriser dans
 * priorityByItem[itemCode]. `current` = ordre actuel affiché (docEntry).
 */
export function reorderPriority(current: number[], docEntry: number, dir: -1 | 1): number[] {
  const idx = current.indexOf(docEntry);
  if (idx === -1) return current;
  const target = idx + dir;
  if (target < 0 || target >= current.length) return current;
  const next = current.slice();
  [next[idx], next[target]] = [next[target], next[idx]];
  return next;
}
