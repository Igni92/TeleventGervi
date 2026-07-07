import { Prisma } from "@prisma/client";

/**
 * Mapping « famille effective » d'un produit pour les analyses commerciales.
 *
 * SAP regroupe tous les petits fruits dans un seul `itemGroup` (« Fruits Rouges »)
 * ce qui rend l'analyse de comportement client peu utile. Idem côté fraises :
 * plusieurs SKU (calibre/marque) ressortent comme « 5× Fraise » dans un top.
 *
 * On dérive donc une **famille effective** depuis le nom de l'item :
 *   - chaque petit fruit a sa propre famille (myrtille, groseille, mûre…)
 *   - toutes les fraises fusionnées en une famille « Fraise »
 *   - les autres produits gardent leur `itemGroup` SAP
 *
 * Évolutif : ajouter une ligne au CASE si une nouvelle famille à isoler
 * apparaît (cf. backlog A4).
 *
 * À utiliser via une CTE qui pré-mappe les Product → (familyKey, familyLabel).
 */
export const FAMILY_CTE_SQL: Prisma.Sql = Prisma.sql`
  SELECT
    p."itemCode",
    p."itemGroup",
    p."groupName",
    p."salesUnitWeight",
    CASE
      WHEN UPPER(p."itemName") LIKE '%MYRTILLE%'  THEN 'myrtille'
      WHEN UPPER(p."itemName") LIKE '%GROSEILLE%' THEN 'groseille'
      WHEN UPPER(p."itemName") LIKE '%FRAMBOISE%' THEN 'framboise'
      WHEN UPPER(p."itemName") LIKE '%CASSIS%'    THEN 'cassis'
      WHEN UPPER(p."itemName") LIKE '%MURE%'
        OR UPPER(p."itemName") LIKE '%MÛRE%'      THEN 'mure'
      WHEN UPPER(p."itemName") LIKE '%FRAISE%'    THEN 'fraise'
      ELSE 'g_' || COALESCE(p."itemGroup"::text, 'na')
    END AS "familyKey",
    CASE
      WHEN UPPER(p."itemName") LIKE '%MYRTILLE%'  THEN 'Myrtille'
      WHEN UPPER(p."itemName") LIKE '%GROSEILLE%' THEN 'Groseille'
      WHEN UPPER(p."itemName") LIKE '%FRAMBOISE%' THEN 'Framboise'
      WHEN UPPER(p."itemName") LIKE '%CASSIS%'    THEN 'Cassis'
      WHEN UPPER(p."itemName") LIKE '%MURE%'
        OR UPPER(p."itemName") LIKE '%MÛRE%'      THEN 'Mûre'
      WHEN UPPER(p."itemName") LIKE '%FRAISE%'    THEN 'Fraise'
      ELSE COALESCE(p."groupName", 'Sans groupe')
    END AS "familyLabel"
  FROM "Product" AS p
`;

/**
 * Version JS du mapping `FAMILY_CTE_SQL` — pour les agrégats déjà calculés
 * côté Node (ex. drilldown mensuel) qui n'ont pas besoin d'un second aller-retour
 * SQL. DOIT rester synchrone avec le CASE ci-dessus (mêmes règles).
 */
/**
 * Familles de fruits ISOLÉES (petits fruits) — celles que `familyOf` distingue
 * du groupe SAP. Sert de liste de choix pour le TARIF PAR FRUITS (fiche client /
 * console). L'ordre est celui du CASE ci-dessus. DOIT rester synchrone avec lui.
 */
export const FRUIT_FAMILIES: { key: string; label: string }[] = [
  { key: "fraise", label: "Fraise" },
  { key: "framboise", label: "Framboise" },
  { key: "myrtille", label: "Myrtille" },
  { key: "groseille", label: "Groseille" },
  { key: "cassis", label: "Cassis" },
  { key: "mure", label: "Mûre" },
];

export function familyOf(
  itemName: string | null | undefined,
  groupName: string | null | undefined,
): { key: string; label: string } {
  const n = (itemName ?? "").toUpperCase();
  if (n.includes("MYRTILLE")) return { key: "myrtille", label: "Myrtille" };
  if (n.includes("GROSEILLE")) return { key: "groseille", label: "Groseille" };
  if (n.includes("FRAMBOISE")) return { key: "framboise", label: "Framboise" };
  if (n.includes("CASSIS")) return { key: "cassis", label: "Cassis" };
  if (n.includes("MURE") || n.includes("MÛRE")) return { key: "mure", label: "Mûre" };
  if (n.includes("FRAISE")) return { key: "fraise", label: "Fraise" };
  const g = groupName?.trim();
  return { key: `g_${g ?? "na"}`, label: g || "Sans groupe" };
}
