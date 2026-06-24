/**
 * Logique « jours de livraison » du client (onglet Logistique).
 *
 * Source = Client.joursLivraison (CSV de jours JS : 0=dim … 6=sam) :
 *   - null / undefined → non configuré → défaut métier « livré du lundi au samedi »
 *   - "" (chaîne vide) → client EXPLICITEMENT non livré (décoché entièrement)
 *   - "1,3,5"          → livré uniquement ces jours
 *
 * Sert à dater un bon (BL) :
 *   - client livré      → prochain jour de livraison à partir de J+1
 *                         (J+1 en semaine, J+2 le samedi car dimanche non livré).
 *   - client non livré  → le jour même (jour le jour).
 */

export const DEFAULT_DELIVERY_DAYS = [1, 2, 3, 4, 5, 6]; // lun → sam

export interface DeliveryDays {
  /** false = le client ne se fait pas livrer (aucun jour coché). */
  delivered: boolean;
  /** jours de livraison (0=dim … 6=sam). Vide si non livré. */
  days: number[];
}

export function parseDeliveryDays(raw: string | null | undefined): DeliveryDays {
  if (raw == null) return { delivered: true, days: [...DEFAULT_DELIVERY_DAYS] };
  const days = raw
    .split(",")
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isInteger(n) && n >= 0 && n <= 6);
  return { delivered: days.length > 0, days };
}

/** Sérialise pour la base : [] → "" (non livré explicite), sinon CSV trié, dédoublonné. */
export function serializeDeliveryDays(days: number[]): string {
  const clean = Array.from(
    new Set(days.filter((n) => Number.isInteger(n) && n >= 0 && n <= 6)),
  ).sort((a, b) => a - b);
  return clean.join(",");
}

/**
 * Date de livraison par défaut d'un bon, à 9 h.
 *   - non livré → `from` (le jour même)
 *   - livré     → 1er jour de livraison ≥ J+1
 */
export function defaultDeliveryDate(dd: DeliveryDays, from: Date = new Date()): Date {
  const at9 = (d: Date) => {
    const x = new Date(d);
    x.setHours(9, 0, 0, 0);
    return x;
  };
  if (!dd.delivered) return at9(from); // jour le jour
  const set = new Set(dd.days);
  for (let i = 1; i <= 14; i++) {
    const cand = new Date(from);
    cand.setDate(cand.getDate() + i);
    if (set.has(cand.getDay())) return at9(cand);
  }
  const fallback = new Date(from);
  fallback.setDate(fallback.getDate() + 1);
  return at9(fallback);
}

const JOUR_LABELS: Record<number, string> = {
  1: "lundi", 2: "mardi", 3: "mercredi", 4: "jeudi", 5: "vendredi", 6: "samedi", 0: "dimanche",
};

/** Libellé court : « lun–sam », « lun, mer, ven », « non livré ». */
export function deliveryDaysLabel(dd: DeliveryDays): string {
  if (!dd.delivered) return "non livré";
  return dd.days
    .slice()
    .sort((a, b) => (a === 0 ? 7 : a) - (b === 0 ? 7 : b))
    .map((d) => JOUR_LABELS[d])
    .join(", ");
}
