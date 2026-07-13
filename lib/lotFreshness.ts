/**
 * FRAÎCHEUR DES LOTS — logique PURE (sans I/O), testée par lib/lotFreshness.test.ts.
 *
 * Règle métier (PRODUCT.md « Do » #4 : « FIFO réel au picking […] lot + DLC » ;
 * audit métier 08-expert-metier priorité 3 : « FEFO réel par DLC, pas LIFO par
 * DocNum ») : pour une denrée périssable, on écoule EN PREMIER le lot dont la DLC
 * est la plus PROCHE, et on ne PROPOSE JAMAIS à la vente un lot déjà PÉRIMÉ
 * (il part en casse/déstockage, pas chez un client).
 *
 * Cette couche transforme la DLC (saisie à la réception, table LotDlc — côté
 * TeleVent) en une DÉCISION de sélection : jusqu'ici la DLC était seulement
 * AFFICHÉE (freshnessLabel), jamais utilisée pour trier/filtrer les lots
 * candidats. C'est la cause directe des « propositions de lot qui datent
 * énormément » : le route candidates proposait, en tête (tri FIFO admission),
 * de vieux lots au registre encore > 0 (fantômes) SANS jamais regarder leur DLC.
 *
 * `today` est TOUJOURS injecté (pas de Date.now() ici) pour rester déterministe.
 */

export type LotFreshness =
  | "fresh"    // DLC > seuil d'alerte → vendable sereinement
  | "expiring" // DLC dans [0 ; seuil] jour(s) → à écouler EN PRIORITÉ
  | "expired"  // DLC dépassée (< aujourd'hui) → NON vendable
  | "unknown"; // DLC non saisie → on ne peut pas décider (repli FIFO)

/** Forme minimale d'un lot pour l'ordonnancement fraîcheur. */
export interface DatedLot {
  /** DLC (LotDlc.expirationDate) — null si non saisie. */
  expirationDate: Date | null;
  /** Date d'entrée (ProductBatch.admissionDate) — repli FIFO quand la DLC manque. */
  admissionDate?: Date | string | null;
  /** N° d'EM — dernier repli de tri (croissant = plus ancien d'abord). */
  docNum?: number | null;
}

const MS_PER_DAY = 86_400_000;

/** Début de journée UTC — une DLC = aujourd'hui reste valable (pas encore périmée). */
function startOfDayUTC(d: Date): number {
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

/** Jours PLEINS entre `today` et la DLC. Négatif = périmé depuis N jours. */
export function daysUntilDlc(expirationDate: Date, today: Date): number {
  return Math.round((startOfDayUTC(expirationDate) - startOfDayUTC(today)) / MS_PER_DAY);
}

/**
 * Classe un lot : périmé / à écouler / frais / DLC inconnue.
 * `warnDays` = fenêtre « à écouler » (défaut 2 j — cohérent avec freshnessLabel
 * ambre ≤ 3 j, mais un cran plus serré pour la PRIORISATION d'écoulement).
 */
export function lotFreshness(
  expirationDate: Date | null | undefined,
  today: Date,
  warnDays = 2,
): LotFreshness {
  if (!expirationDate) return "unknown";
  const d = expirationDate instanceof Date ? expirationDate : new Date(expirationDate);
  if (Number.isNaN(d.getTime())) return "unknown";
  const days = daysUntilDlc(d, today);
  if (days < 0) return "expired";
  if (days <= warnDays) return "expiring";
  return "fresh";
}

/** Un lot est-il PÉRIMÉ (DLC strictement dépassée) à la date `today` ? */
export function isExpiredLot(expirationDate: Date | null | undefined, today: Date): boolean {
  return lotFreshness(expirationDate, today) === "expired";
}

/** ms de la date d'admission (repli FIFO), ou +∞ si absente/illisible. */
function admissionMs(v: DatedLot["admissionDate"]): number {
  if (!v) return Number.POSITIVE_INFINITY;
  const d = v instanceof Date ? v : new Date(v);
  const t = d.getTime();
  return Number.isNaN(t) ? Number.POSITIVE_INFINITY : t;
}

/**
 * Comparateur FEFO (First Expired First Out) pour des lots NON périmés :
 *   1. DLC la plus PROCHE d'abord (à écouler en priorité) ;
 *   2. DLC connue AVANT DLC inconnue (une DLC saisie prime) ;
 *   3. repli sans DLC : FIFO — admission la plus ancienne, puis n° d'EM croissant.
 * Déterministe et stable (aucune égalité laissée au hasard du moteur de tri).
 */
export function compareFEFO(a: DatedLot, b: DatedLot): number {
  const ea = a.expirationDate ? startOfDayUTC(a.expirationDate) : null;
  const eb = b.expirationDate ? startOfDayUTC(b.expirationDate) : null;
  if (ea !== null && eb !== null && ea !== eb) return ea - eb;
  if (ea !== null && eb === null) return -1; // datée avant non-datée
  if (ea === null && eb !== null) return 1;
  const ma = admissionMs(a.admissionDate), mb = admissionMs(b.admissionDate);
  if (ma !== mb) return ma - mb;             // FIFO : plus ancien d'abord
  return (a.docNum ?? 0) - (b.docNum ?? 0);  // repli n° d'EM croissant
}

/**
 * Sépare les lots en PROPOSABLES (non périmés, triés FEFO) et PÉRIMÉS.
 * Ne JAMAIS proposer un lot périmé à la vente : il est isolé dans `expired`
 * (à signaler « à écouler / casse », pas à affecter à un client).
 */
export function partitionByFreshness<T extends DatedLot>(
  lots: T[],
  today: Date,
): { proposable: T[]; expired: T[] } {
  const proposable: T[] = [];
  const expired: T[] = [];
  for (const l of lots) {
    if (isExpiredLot(l.expirationDate, today)) expired.push(l);
    else proposable.push(l);
  }
  proposable.sort(compareFEFO);
  expired.sort(compareFEFO); // les périmés aussi utiles triés (le plus vieux d'abord)
  return { proposable, expired };
}
