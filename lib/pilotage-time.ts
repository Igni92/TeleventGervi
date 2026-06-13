/**
 * Helpers temps purs pour /pilotage — séparés de `pilotage.ts` (qui importe
 * Prisma) pour rester testables dans vitest sans alias `@/`.
 */

export type Granularity = "day" | "week" | "month" | "year";

/** Bornes [start, end[ pour la granularité demandée, ancrée sur `ref` (today par défaut). */
export function periodBounds(g: Granularity, ref = new Date()): { start: Date; end: Date } {
  const d = new Date(ref);
  d.setHours(0, 0, 0, 0);
  let start: Date;
  let end: Date;

  if (g === "day") {
    start = d;
    end = new Date(d); end.setDate(d.getDate() + 1);
  } else if (g === "week") {
    const dow = d.getDay();
    start = new Date(d);
    start.setDate(d.getDate() + (dow === 0 ? -6 : 1 - dow));
    end = new Date(start); end.setDate(start.getDate() + 7);
  } else if (g === "month") {
    start = new Date(d.getFullYear(), d.getMonth(), 1);
    end = new Date(d.getFullYear(), d.getMonth() + 1, 1);
  } else {
    start = new Date(d.getFullYear(), 0, 1);
    end = new Date(d.getFullYear() + 1, 0, 1);
  }
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
    const targetDow = b.start.getDay();
    const currentDow = refMinus1.getDay();
    let delta = targetDow - currentDow;
    if (delta > 3) delta -= 7;
    if (delta < -3) delta += 7;
    refMinus1.setDate(refMinus1.getDate() + delta);
  }
  return periodBounds(g, refMinus1);
}
