/**
 * Décomposition d'un article en désignation complète, dans l'ordre métier
 * (charte Écran 2) : Fruit · Marque · Condt · Variété · Pays.
 *
 * Source des champs (SAP / catalogue local, cf. model Product) :
 *   - Fruit   = itemName  (ex. « Framboise », « Cerise », « Abricot »)
 *   - Marque  = uMarque    (U_GER_Marque — ex. « Driscoll's »)
 *   - Condt   = uCondi      (U_GER_Det_Condt — ex. « 12x125g »)
 *   - Variété = (pas de champ dédié pour l'instant → vide)
 *   - Pays    = uPays      (U_Pays      — ex. « Portugal »)
 *
 * Utilisé par la page Stocks, le formulaire d'entrée marchandise et le détail
 * d'une entrée — pour présenter partout la même désignation décomposée.
 */

export interface ProduitDesignation {
  fruit: string;
  marque: string;
  condt: string;
  variete: string;
  pays: string;
}

export interface ProduitAttributs {
  itemName?: string | null;
  uPays?: string | null;
  uMarque?: string | null;
  uCondi?: string | null;
  /** Réservé : si un champ « variété » dédié est ajouté côté SAP un jour. */
  uVariete?: string | null;
  /** Variété — portée par SAP Items.FrgnName (nom étranger). */
  frgnName?: string | null;
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

/** Décompose un article dans l'ordre Fruit · Marque · Condt · Variété · Pays. */
export function designationProduit(p: ProduitAttributs): ProduitDesignation {
  return {
    fruit: clean(p.itemName) || VIDE,
    marque: clean(p.uMarque) || VIDE,
    condt: clean(p.uCondi) || VIDE,
    variete: clean(p.uVariete) || clean(p.frgnName) || VIDE,
    pays: clean(p.uPays) || VIDE,
  };
}

/** Désignation complète sur une ligne — « Framboise · Driscoll's · 12x125g · Portugal ». */
export function designationCourte(p: ProduitAttributs): string {
  const d = designationProduit(p);
  return [d.fruit, d.marque, d.condt, d.variete, d.pays]
    .filter((x) => x && x !== VIDE)
    .join(" · ");
}
