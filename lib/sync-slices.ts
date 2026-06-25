/**
 * Découpage temporel PUR pour la reconstruction du miroir SAP — séparé de
 * `sapMirror.ts` (qui importe Prisma/SAP) pour rester testable dans vitest sans
 * alias `@/`. Aucune dépendance.
 */

/**
 * Découpe [from, to] en tranches mensuelles (UTC), **plus récente d'abord**.
 *
 * Pourquoi : `pullSalesDocs`/`pullPurchaseDocs` plafonnent silencieusement à
 * 10 000 docs/pull (pagination 100×100). Sur une fenêtre d'un an, un grossiste
 * dépasse ce plafond → en `DocEntry desc` on gardait les récents, mais une
 * resync « propre » doit TOUT reconstruire. Un mois de docs reste très en-deçà
 * de 10 000 : en bouclant mois par mois, aucune tranche n'est tronquée, donc le
 * jour courant (DocEntry les plus hauts) est toujours capté.
 *
 * Ordre récent→ancien : si la reconstruction s'interrompt (timeout serverless),
 * seul l'historique profond manque (re-jouable, upsert idempotent) — le récent,
 * lui, est déjà en base et les KPI du jour s'affichent.
 *
 * Bornes en UTC (cohérent avec `odataDate` qui tronque en date UTC) → pas de
 * décalage d'un jour aux frontières de mois.
 */
export function monthlySlicesDesc(from: Date, to: Date): { from: Date; to: Date }[] {
  const slices: { from: Date; to: Date }[] = [];
  if (to.getTime() < from.getTime()) return slices;

  let end = new Date(to);
  // Garde-fou anti-boucle (~50 ans de mois) si les bornes sont aberrantes.
  for (let guard = 0; guard < 600 && end.getTime() >= from.getTime(); guard++) {
    const monthStart = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), 1));
    const sliceFrom = monthStart.getTime() > from.getTime() ? monthStart : new Date(from);
    slices.push({ from: sliceFrom, to: new Date(end) });
    // Recule au dernier jour du mois précédent (UTC).
    end = new Date(Date.UTC(monthStart.getUTCFullYear(), monthStart.getUTCMonth(), 0));
  }
  return slices;
}
