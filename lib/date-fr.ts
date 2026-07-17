/**
 * Format de date unifié des états SAP (Commandes fournisseurs, Entrées
 * marchandises, Stock…). Objectif : afficher PARTOUT « jour + date » sous la
 * forme `VEN 10.07.26` — jour court FR en majuscules + jj.mm.aa.
 *
 * Source unique : à réutiliser sur tous les écrans plutôt que de redéfinir un
 * `fmtDate` local par fichier.
 */

type DateLike = string | number | Date | null | undefined;

/** Coerce une entrée en Date valide, ou `null` si non parsable. */
function toDate(input: DateLike): Date | null {
  if (input == null || input === "") return null;
  const d = input instanceof Date ? input : new Date(input);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Jour court FR en MAJUSCULES, sans le point d'abréviation : « VEN », « LUN ». */
export function jourCourtFR(d: Date): string {
  return d.toLocaleDateString("fr-FR", { weekday: "short" }).replace(/\.$/, "").toUpperCase();
}

/** Date courte `jj.mm.aa` (points, année sur 2 chiffres). Vide → « — ». */
export function fmtDateCourte(input: DateLike): string {
  const d = toDate(input);
  if (!d) return "—";
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getDate())}.${p(d.getMonth() + 1)}.${p(d.getFullYear() % 100)}`;
}

/** Jour + date : `VEN 10.07.26` — format des états SAP. Vide → « — ». */
export function fmtJourDate(input: DateLike): string {
  const d = toDate(input);
  if (!d) return "—";
  return `${jourCourtFR(d)} ${fmtDateCourte(d)}`;
}

/** Jour + date + heure : `VEN 10.07.26 · 6h45`. Vide → « — ». */
export function fmtJourDateHeure(input: DateLike): string {
  const d = toDate(input);
  if (!d) return "—";
  const heure = `${d.getHours()}h${String(d.getMinutes()).padStart(2, "0")}`;
  return `${fmtJourDate(d)} · ${heure}`;
}

/**
 * Regroupe une liste par JOUR calendaire — pour les états groupés sous une
 * « catégorie » par jour (« VEN 17.05.26 » puis les pièces du jour dessous :
 * entrées marchandises, commandes fournisseurs…).
 *
 * Clé = `yyyy-mm-dd` (10 premiers caractères de la date ISO — les dates SAP
 * sont sans heure). Jours RÉCENTS d'abord ; à l'intérieur d'un jour, l'ordre
 * d'origine de la liste est conservé (DocEntry desc côté API). Une date
 * absente/illisible tombe dans un groupe « — » placé en dernier.
 */
export function groupByJour<T>(
  items: T[],
  dateOf: (item: T) => string | null | undefined,
): { day: string; items: T[] }[] {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const key = (dateOf(item) ?? "").slice(0, 10);
    const arr = groups.get(key);
    if (arr) arr.push(item);
    else groups.set(key, [item]);
  }
  return Array.from(groups.entries())
    .sort(([a], [b]) => (a === b ? 0 : a === "" ? 1 : b === "" ? -1 : a < b ? 1 : -1))
    .map(([day, grouped]) => ({ day, items: grouped }));
}
