/**
 * TARIF PAR FRUITS — prix négociés par CLIENT au niveau d'une DÉSIGNATION fruit
 * (famille + calibre + variété + origine), et non par code article exact.
 *
 * Exemple (fiche client / console) :
 *   Fraise · 3AE · Belgique       → 6,20 €
 *   Fraise · 2AE · Belgique       → 5,80 €
 *   Framboise · Portugal          → 4,50 €   (calibre non précisé → tous calibres)
 *
 * À la création de la commande, on choisit le LOT / code article concret ; son
 * prix descend de la ligne de tarif fruit la plus PRÉCISE qui matche.
 *
 * Pur & testable (aucun I/O). La famille d'un article se dérive via
 * `lib/familles.familyOf`, l'origine de `Product.uPays`, le calibre du champ SAP
 * live `U_GER_CALIBRE` (hints), la variété de `Product.frgnName`.
 */

export interface TarifFruitRow {
  /** Clé de famille (cf. lib/familles.familyOf : "fraise", "framboise"…). Obligatoire. */
  family: string;
  /** Origine (Product.uPays), ex. "Belgique". null/"" = toutes origines. */
  pays?: string | null;
  /** Calibre (U_GER_CALIBRE), ex. "3AE". null/"" = tous calibres. */
  calibre?: string | null;
  /** Variété (Product.frgnName). null/"" = toutes variétés. */
  variete?: string | null;
  /** Prix HT négocié, par unité de stock SAP (comme le tarif par SKU). */
  price: number;
  note?: string | null;
}

/** Attributs d'un article à confronter au tarif fruits. */
export interface ArticleDesignation {
  family: string;
  pays?: string | null;
  calibre?: string | null;
  variete?: string | null;
}

const norm = (s: string | null | undefined): string => (s ?? "").trim().toUpperCase();

/** Un critère de ligne (optionnel) matche-t-il la valeur de l'article ? */
function critMatches(rowVal: string | null | undefined, artVal: string | null | undefined): boolean {
  const r = norm(rowVal);
  if (r === "") return true;          // critère non précisé → matche tout
  return r === norm(artVal);
}

/** Nombre de critères RENSEIGNÉS d'une ligne (hors famille) — plus = plus précis. */
function specificity(row: TarifFruitRow): number {
  return (norm(row.pays) ? 1 : 0) + (norm(row.calibre) ? 1 : 0) + (norm(row.variete) ? 1 : 0);
}

/**
 * Retourne la ligne de tarif fruits la PLUS PRÉCISE qui matche l'article, ou
 * null. « Plus précise » = même famille + tous ses critères renseignés matchent,
 * et un maximum de critères renseignés (Fraise·Belgique·3AE l'emporte sur
 * Fraise·Belgique, qui l'emporte sur Fraise). À égalité, la première rencontrée.
 */
export function matchTarifFruit(rows: TarifFruitRow[], art: ArticleDesignation): TarifFruitRow | null {
  const fam = norm(art.family);
  if (!fam) return null;
  let best: TarifFruitRow | null = null;
  let bestScore = -1;
  for (const row of rows) {
    if (norm(row.family) !== fam) continue;
    if (!critMatches(row.pays, art.pays)) continue;
    if (!critMatches(row.calibre, art.calibre)) continue;
    if (!critMatches(row.variete, art.variete)) continue;
    if (!Number.isFinite(row.price) || row.price < 0) continue;
    const score = specificity(row);
    if (score > bestScore) { best = row; bestScore = score; }
  }
  return best;
}

/** Prix du tarif fruits pour un article, ou null si aucune ligne ne matche. */
export function priceForArticle(rows: TarifFruitRow[], art: ArticleDesignation): number | null {
  const m = matchTarifFruit(rows, art);
  return m ? m.price : null;
}

/** Libellé lisible d'une ligne, ex. « Fraise · 3AE · Belgique ». */
export function tarifFruitLabel(row: { label?: string } & TarifFruitRow, familyLabel?: string): string {
  const parts = [familyLabel || row.label || row.family, row.calibre, row.variete, row.pays]
    .map((p) => (p ?? "").trim())
    .filter(Boolean);
  return parts.join(" · ");
}

/**
 * Nettoie/valide une liste de lignes reçue du client (API PUT). Rejette les
 * lignes sans famille ou à prix invalide ; dédoublonne par clé (famille+origine+
 * calibre+variété, dernière gagne) ; plafonne à `max`.
 */
export function sanitizeTarifFruitRows(input: unknown, max = 300): TarifFruitRow[] {
  if (!Array.isArray(input)) return [];
  const byKey = new Map<string, TarifFruitRow>();
  for (const raw of input) {
    const r = raw as Partial<TarifFruitRow>;
    const family = (r?.family ?? "").toString().trim().toLowerCase();
    const price = Number(r?.price);
    if (!family || !Number.isFinite(price) || price < 0) continue;
    const pays = r?.pays != null && String(r.pays).trim() ? String(r.pays).trim() : null;
    const calibre = r?.calibre != null && String(r.calibre).trim() ? String(r.calibre).trim() : null;
    const variete = r?.variete != null && String(r.variete).trim() ? String(r.variete).trim() : null;
    const note = typeof r?.note === "string" && r.note.trim() ? r.note.trim().slice(0, 120) : null;
    const key = [family, norm(pays), norm(calibre), norm(variete)].join("|");
    byKey.set(key, { family, pays, calibre, variete, price: Math.round(price * 10000) / 10000, note });
  }
  return [...byKey.values()].slice(0, max);
}
