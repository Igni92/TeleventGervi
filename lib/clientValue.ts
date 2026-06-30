/**
 * Valeur client — classement A/B/C/D par chiffre d'affaires 12 mois glissants.
 *
 * Fonction PURE et réutilisable. Le calcul du CA 12 mois (somme des
 * `SapInvoice` sur la période) se fera côté serveur plus tard ; ici on ne
 * fournit QUE le classement par seuils, pour qu'il reste cohérent partout
 * (fiche, console, listes).
 *
 * SEUILS (en euros, CA 12 mois glissants) — AJUSTABLES selon la réalité GERVI :
 *   A : ≥ 50 000 €   — comptes clés, prioritaires
 *   B : ≥ 15 000 €   — clients solides
 *   C : ≥  3 000 €   — clients réguliers de plus faible volume
 *   D : <  3 000 €   — petits comptes / occasionnels
 *
 * Note : ce sont des bornes de départ raisonnables pour un grossiste ;
 * elles devront être recalibrées sur la distribution réelle du portefeuille.
 */

export type ValueTierKey = "A" | "B" | "C" | "D";

export interface ValueTier {
  tier: ValueTierKey;
  label: string;
}

/** Bornes basses (en €) de chaque palier, du plus haut au plus bas. Ajustables. */
export const VALUE_TIER_THRESHOLDS: { tier: ValueTierKey; min: number; label: string }[] = [
  { tier: "A", min: 50_000, label: "Compte clé" },
  { tier: "B", min: 15_000, label: "Client solide" },
  { tier: "C", min: 3_000, label: "Client régulier" },
  { tier: "D", min: 0, label: "Petit compte" },
];

/**
 * Classe un client par son CA 12 mois.
 *
 * Robuste aux valeurs manquantes / aberrantes : tout ce qui n'est pas un
 * nombre fini positif retombe sur le palier D.
 */
export function valueTier(ca12m: number): ValueTier {
  const ca = Number.isFinite(ca12m) && ca12m > 0 ? ca12m : 0;
  const match =
    VALUE_TIER_THRESHOLDS.find((t) => ca >= t.min) ??
    VALUE_TIER_THRESHOLDS[VALUE_TIER_THRESHOLDS.length - 1];
  return { tier: match.tier, label: match.label };
}

/** Libellé court combiné, ex. « A · Compte clé ». */
export function formatTier(t: ValueTier): string {
  return `${t.tier} · ${t.label}`;
}
