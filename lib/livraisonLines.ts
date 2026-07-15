/**
 * CONSOLIDATION D'AFFICHAGE des lignes d'une commande (« Détail livraison »).
 *
 * L'API /api/livraisons fusionne déjà les lignes d'un MÊME code article. Mais un
 * article passé MANQUANT puis RACHETÉ revient parfois sur un 2ᵉ code article
 * (autre appro / autre lot), tout en étant, pour le préparateur, LE MÊME produit :
 * même désignation (nom, marque, conditionnement, calibre, variété, origine).
 * Sans regroupement, un colis complet s'affiche alors éclaté en demi-colis
 * (« 0 mûre » + « 0,5 mûre » + « 0,5 mûre ») alors que le TOTAL du BL, lui, dit
 * bien « 1 colis » — d'où l'incohérence signalée sur la commande ABRE.
 *
 * Ce helper (PUR, testable) regroupe les lignes par DÉSIGNATION identique, cumule
 * les quantités / colis / poids, et écarte les lignes à quantité 0 (l'originale
 * ramenée à 0 après rachat : rien à préparer). Deux produits RÉELLEMENT différents
 * (origine, marque ou calibre distincts) ont une désignation différente → ils
 * restent sur des lignes séparées : on ne fusionne jamais deux produits distincts.
 *
 * ⚠️ Réservé à l'AFFICHAGE (carte commande + bon imprimé). L'écran Manquants
 * continue de raisonner sur les lignes brutes par code article (stock détenu par
 * article) — ne pas appliquer cette consolidation en amont de `buildShortages`.
 */

import type { Line } from "./livraisonView";

/** Ligne d'affichage consolidée : porte tous les codes article fusionnés (≥ 1),
 *  pour retrouver le statut « manquant » quel que soit le code représentatif. */
export type DisplayLine = Line & { mergedCodes: string[] };

/** Arrondi 0,1 — même granularité d'affichage que le reste de la vue livraison. */
const r1 = (n: number) => Math.round(n * 10) / 10;

/** Signature de désignation : deux lignes visuellement identiques pour le
 *  préparateur partagent cette clé (insensible à la casse et aux espaces). */
function designationKey(l: Line): string {
  return [l.itemName, l.marque, l.condt, l.calibre, l.variete, l.pays]
    .map((v) => (v ?? "").toString().trim().toLowerCase())
    .join("|");
}

/**
 * Regroupe les lignes d'un BL par désignation identique et retire les lignes à
 * quantité 0. Le code article (et l'entrepôt) représentatif est celui de la
 * ligne de plus grosse quantité ; `mergedCodes` liste tous les codes fusionnés.
 */
export function consolidateDeliveryLines(lines: Line[]): DisplayLine[] {
  const groups = new Map<string, DisplayLine>();
  for (const l of lines) {
    const key = designationKey(l);
    const g = groups.get(key);
    if (!g) {
      groups.set(key, { ...l, mergedCodes: [l.itemCode] });
      continue;
    }
    // Code + entrepôt représentatifs = la ligne la plus grosse (la plus parlante).
    if (l.quantity > g.quantity) {
      g.itemCode = l.itemCode;
      g.warehouse = l.warehouse;
    }
    g.quantity += l.quantity;
    g.colis += l.colis;
    g.weightKg += l.weightKg;
    if (!g.mergedCodes.includes(l.itemCode)) g.mergedCodes.push(l.itemCode);
  }
  return [...groups.values()]
    .filter((l) => l.quantity > 0)
    .map((l) => ({ ...l, colis: r1(l.colis), weightKg: r1(l.weightKg) }));
}
