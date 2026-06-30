/**
 * Groupes de fraîcheur — 7 familles pour la DLC par défaut (réglage Paramètres).
 * Fonction PURE (aucune dépendance Prisma) → importable côté client ET serveur.
 * Classification par le NOM de l'article (cohérente avec lib/familles `familyOf`,
 * + Kiwi, + « Autres » pour tout le reste).
 */
export type FreshnessGroupKey =
  | "FRAISE"
  | "FRAMBOISE"
  | "MURE"
  | "MYRTILLE"
  | "GROSEILLE"
  | "KIWI"
  | "AUTRES";

export const FRESHNESS_GROUPS: { key: FreshnessGroupKey; label: string }[] = [
  { key: "FRAISE", label: "Fraises" },
  { key: "FRAMBOISE", label: "Framboises" },
  { key: "MURE", label: "Mûres" },
  { key: "MYRTILLE", label: "Myrtilles" },
  { key: "GROSEILLE", label: "Groseilles" },
  { key: "KIWI", label: "Kiwi" },
  { key: "AUTRES", label: "Autres" },
];

/** Classe un article dans l'un des 7 groupes, d'après son nom (MAJUSCULES-insensible). */
export function freshnessGroupKey(itemName: string | null | undefined): FreshnessGroupKey {
  const n = (itemName ?? "").toUpperCase();
  if (n.includes("MYRTILLE")) return "MYRTILLE";
  if (n.includes("GROSEILLE")) return "GROSEILLE";
  if (n.includes("FRAMBOISE")) return "FRAMBOISE";
  if (n.includes("MURE") || n.includes("MÛRE")) return "MURE";
  if (n.includes("KIWI")) return "KIWI";
  if (n.includes("FRAISE")) return "FRAISE";
  return "AUTRES";
}
