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

/** Jour + date + heure, tournure « à » : `VEN 10.07.26 à 6h45`. Vide → « — ».
 *  Utilisé pour le libellé « BL <n°> du … à … » du détail livraison. */
export function fmtJourDateHeureA(input: DateLike): string {
  const d = toDate(input);
  if (!d) return "—";
  const heure = `${d.getHours()}h${String(d.getMinutes()).padStart(2, "0")}`;
  return `${fmtJourDate(d)} à ${heure}`;
}

/** Jour + date à ANNÉE PLEINE : `LUN 31.08.2026`. Vide → « — ».
 *  Pour les modules où l'année complète est voulue (sélecteur de date livraison). */
export function fmtJourDatePleine(input: DateLike): string {
  const d = toDate(input);
  if (!d) return "—";
  const p = (n: number) => String(n).padStart(2, "0");
  return `${jourCourtFR(d)} ${p(d.getDate())}.${p(d.getMonth() + 1)}.${d.getFullYear()}`;
}
