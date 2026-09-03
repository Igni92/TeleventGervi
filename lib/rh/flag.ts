/**
 * Feature-flag du module RH V2. La nouvelle expérience (badgeuse, espace salarié,
 * cockpit RH…) est MASQUÉE par défaut : on bascule écran par écran. Rollback =
 * flag off (les données KV historiques restent la source du RH actuel).
 *
 * Actif si `RH_V2=1` (env) OU en préversion (VERCEL_ENV=preview) pour la recette.
 */
export function isRhV2Enabled(): boolean {
  return process.env.RH_V2 === "1" || process.env.VERCEL_ENV === "preview";
}
