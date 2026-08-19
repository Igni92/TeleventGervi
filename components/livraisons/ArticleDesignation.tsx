import { cn } from "@/lib/utils";

// Désignation article partagée par TOUS les onglets livraisons (Préparation,
// Par article, Ventes du jour). Règle métier voulue par les préparateurs :
// MARQUE et CALIBRE sont les repères principaux — ils s'affichent en blanc
// (foreground), à côté du fruit ; le conditionnement / la variété / le pays
// restent secondaires (muted).

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

/** Sépare la désignation : `strong` = marque + calibre (mis en avant),
 *  `muted` = conditionnement + variété + pays (secondaire). */
export function designationParts(l: DesignationFields): { strong: string[]; muted: string[] } {
  const strong: string[] = [];
  if (okPart(l.marque)) strong.push(l.marque!.trim());
  if (okPart(l.calibre)) strong.push(calibreLabel(l.calibre!));
  const muted: string[] = [];
  if (okPart(l.condt)) muted.push(l.condt!.trim());
  if (okPart(l.variete)) muted.push(l.variete!.trim());
  if (okPart(l.pays)) muted.push(l.pays!.trim());
  return { strong, muted };
}

/** Chaîne plate de toutes les parties (recherche / repli). */
export function designationSearch(l: DesignationFields): string {
  const { strong, muted } = designationParts(l);
  return [...strong, ...muted].join(" · ");
}

/**
 * Rendu inline : « Belorta · cal. 20 » (blanc) suivi de « 8×500g · Espagne »
 * (muted). Tronque proprement dans une cellule étroite.
 */
export function ArticleDesignation({
  l,
  className,
}: {
  l: DesignationFields;
  className?: string;
}) {
  const { strong, muted } = designationParts(l);
  if (strong.length === 0 && muted.length === 0) return null;
  return (
    <span className={cn("min-w-0 truncate", className)}>
      {strong.length > 0 && (
        <span className="font-semibold text-foreground">{strong.join(" · ")}</span>
      )}
      {strong.length > 0 && muted.length > 0 && (
        <span className="text-muted-foreground"> · </span>
      )}
      {muted.length > 0 && <span className="text-muted-foreground">{muted.join(" · ")}</span>}
    </span>
  );
}
