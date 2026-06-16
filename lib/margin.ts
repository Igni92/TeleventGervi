/**
 * Marge BRUTE — base de calcul UNIQUE partagée par tous les écrans pilotage.
 *
 * Règle métier (juin 2026) :
 *   • La marge est BRUTE et se calcule LIGNE À LIGNE :
 *       marge = Σ (lineTotal − quantité × coût d'entrée marchandise réel)
 *     (coût EM réel, jamais le grossProfit/lineCost SAP — cf. lib/cogs.ts).
 *     Le transport et autres charges ne sont PAS déduits ici : la « marge
 *     nette transport » sera dérivée plus tard, à partir de cette marge brute.
 *   • La MARGE % se rapporte TOUJOURS au CA produit NET (lignes isService=false,
 *     avoirs déduits) — JAMAIS au CA total (qui inclut services/refacturations
 *     sans coût d'achat) ni au volume BL. Inclure les services au dénominateur
 *     sous-évalue mécaniquement la marge %.
 *
 * Module volontairement PUR (aucun import serveur) : importable à la fois côté
 * serveur (lib/pilotage.ts) et côté client (composants pilotage), garantissant
 * qu'écran 1, écran 2, matrice annuelle et tops affichent le MÊME calcul.
 */
export function grossMarginPct(margin: number, caProductNet: number): number {
  return caProductNet > 0 ? (margin / caProductNet) * 100 : 0;
}
