/**
 * Décomposition d'un article en désignation complète, dans l'ordre métier
 * demandé : Fruit · Pays · Marque · Variété · Condt.
 *
 * Source des champs (SAP / catalogue local, cf. model Product) :
 *   - Fruit   = itemName  (ex. « Framboise », « Cerise », « Abricot »)
 *   - Pays    = uPays      (U_Pays      — ex. « Portugal »)
 *   - Marque  = uMarque    (U_GER_Marque — ex. « Driscoll's »)
 *   - Variété = (pas de champ dédié pour l'instant → vide)
 *   - Condt   = uCondi      (U_GER_Det_Condt — ex. « 12x125g »)
 *
 * Utilisé par la page Stocks, le formulaire d'entrée marchandise et le détail
 * d'une entrée — pour présenter partout la même désignation décomposée.
 */

export interface ProduitDesignation {
  fruit: string;
  pays: string;
  marque: string;
  variete: string;
  condt: string;
}

export interface ProduitAttributs {
  itemName?: string | null;
  uPays?: string | null;
  uMarque?: string | null;
  uCondi?: string | null;
  /** Réservé : si un champ « variété » est ajouté côté SAP un jour. */
  uVariete?: string | null;
}

/** Marqueur d'« absence de valeur » homogène dans toute l'UI. */
export const VIDE = "—";

/** Nettoie une valeur SAP : trim, et les placeholders (« - », « . », vide) → vide. */
function clean(v: string | null | undefined): string {
  const s = (v ?? "").trim();
  if (!s || s === "-" || s === "." || s === "—") return "";
  return s;
}

/** Affiche une valeur, ou le marqueur de vide si absente. */
export function ouVide(v: string | null | undefined): string {
  return clean(v) || VIDE;
}

/** Décompose un article dans l'ordre Fruit · Pays · Marque · Variété · Condt. */
export function designationProduit(p: ProduitAttributs): ProduitDesignation {
  return {
    fruit: clean(p.itemName) || VIDE,
    pays: clean(p.uPays) || VIDE,
    marque: clean(p.uMarque) || VIDE,
    variete: clean(p.uVariete) || VIDE,
    condt: clean(p.uCondi) || VIDE,
  };
}

/** Désignation complète sur une ligne — « Framboise · Portugal · Driscoll's · 12x125g ». */
export function designationCourte(p: ProduitAttributs): string {
  const d = designationProduit(p);
  return [d.fruit, d.pays, d.marque, d.variete, d.condt]
    .filter((x) => x && x !== VIDE)
    .join(" · ");
}
