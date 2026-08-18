/**
 * PALETTES d'un bon de livraison.
 *
 * Le nombre de palettes n'existe pas dans SAP : il est constaté au moment où la
 * commande est préparée (« fait »), puis totalisé par transporteur sur le bon de
 * transport que signe le chauffeur — colonne jusqu'ici laissée vide et remplie à
 * la main (cf. lib/bonTransport.ts).
 *
 * Quatre types. « Medium » et « Europe » partagent le format 80×120 mais restent
 * DISTINCTES : ce sont deux parcs différents (l'Europe est consignée/échangée,
 * pas la Medium) — les compter ensemble empêcherait de suivre les retours.
 *
 * Module PUR (aucun accès base ni DOM) : la persistance vit dans lib/inventory.ts
 * avec les autres marques par BL, et le rendu dans lib/bonTransport.ts.
 */

export type PaletteKind = "demi" | "medium" | "europe" | "xl";

export interface PaletteType {
  key: PaletteKind;
  /** Libellé court — tuiles de saisie et en-têtes de colonne. */
  label: string;
  /** Format imprimé sous le libellé (ex. « 80 × 120 cm »). */
  size: string;
}

/** Ordre d'affichage : du plus petit au plus grand encombrement. */
export const PALETTE_TYPES: readonly PaletteType[] = [
  { key: "demi",   label: "Demi-palette",   size: "50 × 60 cm" },
  { key: "medium", label: "Palette Medium", size: "80 × 120 cm" },
  { key: "europe", label: "Palette Europe", size: "80 × 120 cm" },
  { key: "xl",     label: "Palette XL",     size: "100 × 120 cm" },
] as const;

/** Comptage par type. Un type absent vaut 0 (jamais `undefined` en sortie). */
export type PaletteCounts = Record<PaletteKind, number>;

export const EMPTY_PALETTES: PaletteCounts = { demi: 0, medium: 0, europe: 0, xl: 0 };

const KEYS: PaletteKind[] = PALETTE_TYPES.map((t) => t.key);

/**
 * Normalise une saisie quelconque (JSON stocké, corps de requête, champ de
 * formulaire) en comptage sûr : entiers >= 0, types inconnus ignorés.
 * Un nombre à virgule est tronqué — une demi-palette est un TYPE, pas 0,5.
 */
export function normalizePalettes(input: unknown): PaletteCounts {
  const out: PaletteCounts = { ...EMPTY_PALETTES };
  if (!input || typeof input !== "object") return out;
  const src = input as Record<string, unknown>;
  for (const k of KEYS) {
    const n = Number(src[k]);
    out[k] = Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
  }
  return out;
}

/** Total toutes tailles confondues — « a-t-on saisi quelque chose ? ». */
export function totalPalettes(c: PaletteCounts): number {
  return KEYS.reduce((s, k) => s + (c[k] || 0), 0);
}

/** Vrai si rien n'a été compté (case à remplir à la main sur le bon). */
export function isEmptyPalettes(c: PaletteCounts): boolean {
  return totalPalettes(c) === 0;
}

/** Somme de plusieurs BL — total par transporteur sur le bon de transport. */
export function sumPalettes(list: readonly PaletteCounts[]): PaletteCounts {
  const out: PaletteCounts = { ...EMPTY_PALETTES };
  for (const c of list) for (const k of KEYS) out[k] += c[k] || 0;
  return out;
}

/**
 * Résumé court pour une cellule/ligne : « 2 Medium · 1 XL ».
 * Chaîne vide si rien n'est compté — l'appelant décide quoi afficher à la place
 * (une case vide à remplir à la main, typiquement).
 */
export function formatPalettes(c: PaletteCounts): string {
  return PALETTE_TYPES
    .filter((t) => (c[t.key] || 0) > 0)
    .map((t) => `${c[t.key]} ${t.label.replace("Palette ", "").replace("Demi-palette", "Demi")}`)
    .join(" · ");
}
