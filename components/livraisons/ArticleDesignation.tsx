import { cn } from "@/lib/utils";

// Désignation article partagée par TOUS les onglets livraisons (Préparation,
// Par article, Ventes du jour). Disposition voulue par les préparateurs :
//   Ligne 1 : Fruit + MARQUE + CALIBRE  (repères principaux, en blanc)
//   Ligne 2 : conditionnement · variété · pays  (secondaire, muted)
//
// Le nom du fruit est rendu par l'appelant (styles variables : troncature,
// barré si manquant…). On expose donc deux morceaux à placer :
//   <DesignationStrong/> — inline, à coller après le nom sur la ligne 1
//   <DesignationMuted/>  — bloc, à poser dessous sur la ligne 2

export interface DesignationFields {
  marque?: string | null;
  condt?: string | null;
  calibre?: string | null;
  variete?: string | null;
  pays?: string | null;
}

const okPart = (v?: string | null) =>
  !!v && v.trim() !== "" && v.trim() !== "—" && v.trim() !== "-";

const calibreLabel = (c: string) =>
  /^cal\.?\s/i.test(c.trim()) ? c.trim() : `cal. ${c.trim()}`;

/** Parties fortes (ligne 1, blanc) : marque + calibre. */
export function strongParts(l: DesignationFields): string[] {
  const out: string[] = [];
  if (okPart(l.marque)) out.push(l.marque!.trim());
  if (okPart(l.calibre)) out.push(calibreLabel(l.calibre!));
  return out;
}

/** Parties secondaires (ligne 2, muted) : conditionnement + variété + pays. */
export function mutedParts(l: DesignationFields): string[] {
  const out: string[] = [];
  if (okPart(l.condt)) out.push(l.condt!.trim());
  if (okPart(l.variete)) out.push(l.variete!.trim());
  if (okPart(l.pays)) out.push(l.pays!.trim());
  return out;
}

/** Chaîne plate de toutes les parties (recherche / repli). */
export function designationSearch(l: DesignationFields): string {
  return [...strongParts(l), ...mutedParts(l)].join(" · ");
}

/** Marque + calibre en BLANC, inline — se place juste après le nom du fruit. */
export function DesignationStrong({ l, className }: { l: DesignationFields; className?: string }) {
  const strong = strongParts(l);
  if (strong.length === 0) return null;
  return (
    <span className={cn("font-semibold text-foreground", className)}>{strong.join(" · ")}</span>
  );
}

/** Conditionnement · variété · pays, muted — se place sur la ligne du dessous. */
export function DesignationMuted({ l, className }: { l: DesignationFields; className?: string }) {
  const muted = mutedParts(l);
  if (muted.length === 0) return null;
  // Info secondaire (ne concurrence pas le fruit + marque + calibre de la ligne
  // 1), mais lisible : muted-foreground plein — pas d'opacité qui la ferait
  // disparaître sur fond clair.
  return (
    <span className={cn("block truncate text-muted-foreground", className)}>{muted.join(" · ")}</span>
  );
}
