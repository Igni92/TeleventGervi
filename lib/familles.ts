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
 * ⚠️ Ce module est importé par des COMPOSANTS CLIENT (tarif par fruits :
 * fiche client, console). Il doit donc rester **SANS import Prisma** : la
 * CTE SQL (`Prisma.sql`, serveur uniquement) vit dans `lib/famillesSql.ts`.
 * Ne PAS y ré-introduire d'import `@prisma/client`, sinon le bundle client
 * plante (« sqltag is unable to run in this browser environment »).
 * Les règles ci-dessous DOIVENT rester synchrones avec FAMILY_CTE_SQL.
 */

/**
 * Familles de fruits ISOLÉES (petits fruits) — celles que `familyOf` distingue
 * du groupe SAP. Sert de liste de choix pour le TARIF PAR FRUITS (fiche client /
 * console). L'ordre est celui du CASE de FAMILY_CTE_SQL. DOIT rester synchrone.
 */
export const FRUIT_FAMILIES: { key: string; label: string }[] = [
  { key: "fraise", label: "Fraise" },
  { key: "framboise", label: "Framboise" },
  { key: "myrtille", label: "Myrtille" },
  { key: "groseille", label: "Groseille" },
  { key: "cassis", label: "Cassis" },
  { key: "mure", label: "Mûre" },
];

/**
 * Version JS du mapping `FAMILY_CTE_SQL` (lib/famillesSql.ts) — pour les agrégats
 * déjà calculés côté Node (ex. drilldown mensuel) qui n'ont pas besoin d'un second
 * aller-retour SQL. DOIT rester synchrone avec le CASE de FAMILY_CTE_SQL.
 */
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
  // ⚠️ REPLI (hors petits fruits) : la clé est dérivée du NOM de groupe
  // (`g_<groupName>`), alors que FAMILY_CTE_SQL / getFamilyItems dérivent la leur
  // de l'ID de groupe (`g_<itemGroup>`). Ces deux clés NE COÏNCIDENT PAS. `familyOf`
  // convient donc pour REGROUPER des lignes entre elles (agrégats auto-cohérents :
  // poids par famille, drilldown pilotage), mais JAMAIS pour COMPARER un article à
  // une clé issue du CTE (ex. valider l'appartenance famille en fabrication : côté
  // serveur, calculer la clé avec la règle SQL `g_<itemGroup>` — cf.
  // app/api/sap/assembly/route.ts).
  const g = groupName?.trim();
  return { key: `g_${g ?? "na"}`, label: g || "Sans groupe" };
}
