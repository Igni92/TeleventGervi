/**
 * Helpers temps purs pour /pilotage — séparés de `pilotage.ts` (qui importe
 * Prisma) pour rester testables dans vitest sans alias `@/`.
 */

// Audit 2026-08-13 (#21) : import RELATIF (pas d'alias `@/`) pour préserver la
// testabilité vitest de ce module. `paris-time` est lui-même 100 % `Intl` sans
// dépendance → sûr à importer ici.
import { parisStartOfDay, parisEndOfDay, parisDayOfWeek } from "./paris-time";

export type Granularity = "day" | "week" | "month" | "year";

/**
 * Audit 2026-08-13 (#21) — année/mois/jour CIVILS à Europe/Paris pour un instant.
 * Le serveur tourne en UTC : `Date.getFullYear()/getMonth()` renverraient la
 * date UTC, décalée d'1–2 h par rapport à l'heure murale française → « le mois »
 * (ou l'année, le 1er janvier) basculait trop tôt. On lit la date française.
 */
export function parisCivilParts(ref: Date = new Date()): { year: number; month: number; day: number } {
  const [y, m, d] = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Paris", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(ref).split("-").map(Number);
  return { year: y, month: m, day: d };
}

/**
 * Nombre d'années d'historique affichées par le rapport annuel (Écran 2) EN PLUS
 * de l'année courante. `2` ⇒ matrice N-2, N-1, N (3 colonnes). Source unique de
 * vérité partagée entre l'agrégat (`annualMatrix`) et la fenêtre de synchro du
 * miroir (`full-reset` / `backfill`) : les deux DOIVENT couvrir la même
 * profondeur, sinon la matrice affiche des colonnes vides faute de docs importés.
 */
export const ANNUAL_MATRIX_YEARS_BACK = 2;

/**
 * 1er janvier de la 1ʳᵉ année affichée par le rapport annuel = borne basse que la
 * synchro du miroir doit atteindre pour que la matrice soit complète.
 *
 * ⚠️ Bug historique : le miroir n'était (re)synchronisé que sur ~1 an (défaut
 * `today − 365 j`) alors que la matrice remonte 3 ans → 2024 et le début 2025
 * restaient vides. On aligne désormais la fenêtre de synchro sur CETTE borne.
 */
export function annualWindowStart(
  yearsBack: number = ANNUAL_MATRIX_YEARS_BACK,
  ref: Date = new Date(),
): Date {
  return new Date(ref.getFullYear() - yearsBack, 0, 1);
}

/**
 * Bornes [start, end[ pour la granularité demandée, ancrée sur `ref` (today par
 * défaut) — TOUJOURS en Europe/Paris.
 *
 * Audit 2026-08-13 (#21) : l'ancienne version bornait via `new Date()` +
 * `setHours(0,0,0,0)` + getters/setters LOCAUX = UTC en prod. Résultat : « le
 * jour » basculait à 01h/02h heure de Paris, donc le soir les KPI « vendu
 * aujourd'hui » (accueil) et les vues jour/semaine/mois du pilotage lisaient la
 * mauvaise fenêtre. On borne désormais en heure française (parisStartOfDay/
 * parisEndOfDay + date civile Paris pour mois/année/semaine).
 */
export function periodBounds(g: Granularity, ref = new Date()): { start: Date; end: Date } {
  const DAY_MS = 24 * 3600_000;

  if (g === "day") {
    // Jour de Paris : minuit → minuit du lendemain (parisEndOfDay absorbe les
    // jours de 23 h/25 h des changements d'heure).
    return { start: parisStartOfDay(ref), end: parisEndOfDay(ref) };
  }

  if (g === "week") {
    // Lundi 00:00 Paris de la semaine contenant `ref`, jusqu'au lundi suivant.
    // On part du début du jour Paris puis on décale de N jours (+DAY_MS × N)
    // re-normalisés par parisStartOfDay → insensible aux changements d'heure.
    const dow = parisDayOfWeek(ref);                 // 0 = dimanche … 6 = samedi
    const toMonday = dow === 0 ? -6 : 1 - dow;
    const startOfToday = parisStartOfDay(ref);
    const start = parisStartOfDay(new Date(startOfToday.getTime() + toMonday * DAY_MS));
    const end = parisStartOfDay(new Date(start.getTime() + 7 * DAY_MS));
    return { start, end };
  }

  if (g === "month") {
    const { year, month } = parisCivilParts(ref);
    // 1er du mois à 00:00 Paris : minuit UTC le 1er tombe toujours le 1er à Paris
    // (Paris ≥ UTC+1) → parisStartOfDay le recale sur minuit heure française.
    const start = parisStartOfDay(new Date(Date.UTC(year, month - 1, 1)));
    const nm = month === 12 ? { y: year + 1, m: 1 } : { y: year, m: month + 1 };
    const end = parisStartOfDay(new Date(Date.UTC(nm.y, nm.m - 1, 1)));
    return { start, end };
  }

  // year — 1er janvier 00:00 Paris → 1er janvier suivant.
  const { year } = parisCivilParts(ref);
  const start = parisStartOfDay(new Date(Date.UTC(year, 0, 1)));
  const end = parisStartOfDay(new Date(Date.UTC(year + 1, 0, 1)));
  return { start, end };
}

/**
 * Période N-1 alignée à la granularité — comparaison YoY métier-correcte :
 *
 *   - `day`   → **même jour de la semaine** l'an passé (samedi vs samedi…).
 *               On part de `start - 1 an` puis on ajuste de ± 3 jours max pour
 *               retomber sur le bon DoW. Évite le piège "mardi 4 juin 2026 vs
 *               mercredi 4 juin 2025" qui invalide la saisonnalité hebdo.
 *   - `week`  → **même semaine ISO** (lundi-dimanche) qui contient `start - 1 an`.
 *   - `month` → **même mois N-1** (1er → 1er du suivant).
 *   - `year`  → année calendaire N-1.
 *
 * Pour week/month/year on délègue à `periodBounds` après shift -1 an, ce qui
 * cale automatiquement la fenêtre (le drift calendaire 365j/366j est absorbé
 * par le re-snap sur les bornes naturelles de la granularité).
 *
 * `g` est optionnel pour rétro-compat (par défaut `month`, conservant l'ancien
 * comportement raisonnable pour les callers historiques).
 */
export function previousYearBounds(
  b: { start: Date; end: Date },
  g: Granularity = "month",
): { start: Date; end: Date } {
  const refMinus1 = new Date(b.start);
  refMinus1.setFullYear(refMinus1.getFullYear() - 1);

  if (g === "day") {
    // Aligne sur le même jour de la semaine que b.start ; delta dans ]-4, +3].
    // Audit 2026-08-13 (#21) : DoW lu en Europe/Paris — `b.start` est désormais
    // un instant « minuit Paris » (≈ 22 h/23 h UTC la veille) ; `getDay()` en
    // prod UTC renverrait le jour de la VEILLE et casserait l'alignement YoY.
    const targetDow = parisDayOfWeek(b.start);
    const currentDow = parisDayOfWeek(refMinus1);
    let delta = targetDow - currentDow;
    if (delta > 3) delta -= 7;
    if (delta < -3) delta += 7;
    refMinus1.setDate(refMinus1.getDate() + delta);
  }
  return periodBounds(g, refMinus1);
}
