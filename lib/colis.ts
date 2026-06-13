/**
 * Conditionnement COLIS — nb de colis EXACT + poids d'un colis (kg).
 *
 * Fonctions PURES (zéro I/O) afin d'être testables hors-ligne — d'où ce module
 * dédié plutôt qu'un ajout dans lib/fabrication.ts (qui importe Prisma). Le
 * helper est ré-exporté par lib/fabrication.ts, à côté de `packRatio`, pour
 * rester découvrable au même endroit que la logique colis/pack existante.
 *
 * RÈGLE MÉTIER (TeleVent) : tout article se vend en COLIS contenant X de son
 * unité de base :
 *   • unité de base = kg        → 1 colis = X kg ;
 *   • unité de base = barquette → 1 colis = X barquettes ;
 *   • unité de base = colis     → 1 colis (l'article EST le colis).
 * D'où  nbColis = quantité_inventaire / unitsPerColis  (TOUJOURS exact) et
 *       poids d'un colis = salesUnitWeight × unités-par-colis.
 */

/**
 * Champs unité d'un Product nécessaires au calcul du conditionnement colis.
 * (Tous nullable : on tombe sur des défauts métier sûrs quand SAP est lacunaire.)
 */
export interface ProductColisFields {
  salesUnit?: string | null;           // SAP SalesUnit ("KG" | "pie" | "Colis" | "barq"…)
  salesQtyPerPackUnit?: number | null; // SAP SalPackUn — unités de base par colis (ex. 12, 20)
  salesUnitWeight?: number | null;     // SAP SalesUnitWeight — poids d'1 unité de base, kg
}

export interface ColisInfo {
  /**
   * Diviseur EXACT pour passer de la quantité d'inventaire SAP au nombre de
   * colis : `nbColis = quantité_inventaire / unitsPerColis`. Jamais « approx ».
   *   • article au KG  → kg par colis (= SalPackUn si >1, sinon le poids d'un
   *     colis/sac = salesUnitWeight, sinon 1) ;
   *   • article au COLIS / barquette regroupée / pie → SalPackUn (unités de
   *     base par colis) si >1, sinon 1 (l'article EST déjà le colis).
   */
  unitsPerColis: number;
  /** Poids d'UN colis en kg (null si poids inconnu pour un article non-kg). */
  colisWeightKg: number | null;
  /** Mot de comptage pour l'UI : "colis" (défaut) ou "barquette" si unité réelle. */
  unitLabel: string;
}

/**
 * Conditionnement colis d'un article — SOURCE UNIQUE pour « nb colis exact » et
 * « poids d'un colis ». Cohérent avec :
 *   • `packRatio` (lib/fabrication) et le régime HISTORIQUE de `unitInfo`
 *     (lib/gervifrais-calc) que le front (Ecran2Order) utilise pour convertir
 *     colis → quantité SAP : pour un article non-kg, `quantité SAP = colis ×
 *     SalPackUn` → on récupère donc les colis en divisant par le MÊME SalPackUn.
 *   • `uniteGestion` (lib/fabrication-optim) pour le libellé barquette/colis.
 *
 * ⚠️ Divergence ASSUMÉE avec le « nouveau régime » de `unitInfo` qui multiplie
 *    aussi par NumInSale (SalesItemsPerUnit) : sur les données réelles
 *    (sap_export/Items.csv) NumInSale vaut 1 sur 1249/1253 articles, et là où
 *    il diffère (ENDIVE KG NumInSale=5 SalPackUn=5, condi "5kg") le multiplier
 *    donnerait 25 kg/colis au lieu de 5. Pour COMPTER des colis on s'appuie donc
 *    sur le seul SalPackUn (validé par U_GER_Det_Condt), jamais NumInSale.
 *
 * Exemples (relevés SAP réels) :
 *   • AIL          : KG, SalPackUn 20, wt 1     → 20 kg/colis, nbColis = kg/20.
 *   • BANANE "3"   : KG, SalPackUn ≤1, wt 3.5   → 3.5 kg/colis (sac), nb = kg/3.5.
 *   • FRAMB12PD/MD : pie, SalPackUn 12, wt 0.125 → 12 barq./colis, colis = 1.5 kg,
 *                    nbColis = qté_pie / 12 (le piège « prix /barquette, vente /colis »).
 *   • AVOCAT 4KG   : Colis, SalPackUn 15, wt 0.3 → colis = 4.5 kg, nbColis = qté/15
 *                    (le front envoie colis×15 à SAP, on redivise par 15).
 */
export function colisInfo(p: ProductColisFields): ColisInfo {
  const brut = (p.salesUnit ?? "").trim();
  const isKg = /kg|kilo/i.test(brut);
  const salPackUn = p.salesQtyPerPackUnit && p.salesQtyPerPackUnit > 1 ? p.salesQtyPerPackUnit : null;
  const unitWeight = p.salesUnitWeight && p.salesUnitWeight > 0 ? p.salesUnitWeight : null;

  if (isKg) {
    // Quantité SAP en kg. Un colis pèse SalPackUn kg (cas courant : "20kg", "5kg")
    // ou, à défaut de regroupement, le poids du sac/colis = salesUnitWeight.
    const kgParColis = salPackUn ?? unitWeight ?? 1;
    return { unitsPerColis: kgParColis, colisWeightKg: kgParColis, unitLabel: "colis" };
  }

  // Non-kg : quantité SAP en unités de base (pie/barquette) ou déjà en colis.
  // unitsPerColis = SalPackUn (>1) sinon 1. Poids = unités × poids/unité.
  const unitsPerColis = salPackUn ?? 1;
  const colisWeightKg = unitWeight != null
    ? Math.round(unitsPerColis * unitWeight * 1000) / 1000
    : null;
  // Libellé : "barquette" UNIQUEMENT si c'est l'unité réelle non regroupée
  // (même règle que uniteGestion) — jamais « pièce ».
  const unitLabel = salPackUn == null && /barq|bqt/i.test(brut) ? "barquette" : "colis";
  return { unitsPerColis, colisWeightKg, unitLabel };
}
