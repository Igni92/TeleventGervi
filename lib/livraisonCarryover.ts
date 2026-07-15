/**
 * Report de la FILE DE PRÉPARATION (« Détail livraison ») — logique pure, testée
 * hors SAP/Prisma.
 *
 * RÈGLE MÉTIER : une commande MISE EN PRÉPARATION par le commercial reste dans la
 * file du préparateur TANT QU'ELLE N'EST PAS FAITE. On la reporte donc dans la
 * vue d'un jour donné même si sa date de livraison (DocDueDate) n'y tombe pas :
 *   • EN RETARD  — due un jour déjà passé, pas encore faite → reportée au lendemain
 *                  (et les jours suivants) jusqu'à ce qu'elle soit marquée « faite » ;
 *   • EN AVANCE  — mise en prépa le 10 pour une livraison le 15 → visible chaque
 *                  jour d'ici la livraison.
 *
 * Une commande n'est PAS reportée si elle est déjà faite, déjà partie, exclue
 * (avoir manuel), ou si sa mise à disposition (misEnPrepAt) est POSTÉRIEURE au
 * jour affiché (on ne la fait pas remonter dans un passé où elle n'existait pas
 * encore dans la file).
 */

/** Statuts manuels nécessaires au report (sous-ensemble de getDeliveryStatuses). */
export interface CarryoverStatuses {
  misEnPrep: Map<number, boolean>;
  prepared: Map<number, boolean>;
  departed: Map<number, boolean>;
  excluded: Map<number, boolean>;
  misEnPrepAt: Map<number, string>;
}

/**
 * DocEntries à REPORTER dans la vue du jour `date` (ISO « YYYY-MM-DD ») :
 * commandes mises en préparation, ni faites ni parties ni exclues, mises à
 * disposition au plus tard ce jour-là, et pas déjà présentes dans la vue
 * (`present` = DocEntries déjà chargés par le filtre DocDueDate du jour).
 */
export function selectCarryoverEntries(
  s: CarryoverStatuses,
  date: string,
  present: ReadonlySet<number>,
): number[] {
  const out: number[] = [];
  for (const [de, on] of s.misEnPrep) {
    if (!on || present.has(de)) continue;                    // pas lâchée, ou déjà présente
    if (s.prepared.get(de) || s.departed.get(de)) continue;  // déjà faite / partie
    if (s.excluded.get(de)) continue;                        // avoir / exclu manuel
    const at = s.misEnPrepAt.get(de);
    if (at && at.slice(0, 10) > date) continue;              // pas encore mise à dispo à cette date
    out.push(de);
  }
  return out;
}
