/**
 * CA 12 mois glissants par client — agrégat sur le miroir SAP local.
 *
 * Source de la VALEUR client (palier A/B/C/D, cf. `lib/clientValue.ts`) et
 * entrée du score de priorité d'appel (`lib/priority.ts`, audit 07 #48).
 *
 * Clé de jointure : `SapInvoice.cardCode` === `Client.code` (le CardCode SAP est
 * le code client). On somme `docTotal` (HT) des factures NON annulées sur les
 * 365 derniers jours. Aligné sur le pattern d'agrégation de `lib/pilotage.ts`
 * (`cancelled: false`, groupBy cardCode, _sum docTotal).
 */

import { prisma } from "@/lib/prisma";

/** Fenêtre glissante du CA « 12 mois » (en jours). */
export const CA_WINDOW_DAYS = 365;

/**
 * CA 12 mois glissants (€ HT) indexé par code client, pour une liste de codes.
 *
 * Renvoie une Map ne contenant que les clients ayant facturé sur la période
 * (les absents valent implicitement 0 côté appelant). Liste vide → Map vide,
 * sans requête.
 */
export async function caByClientCode(
  codes: string[],
  now: Date = new Date(),
): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  if (codes.length === 0) return map;

  const since = new Date(now);
  since.setDate(since.getDate() - CA_WINDOW_DAYS);

  const grouped = await prisma.sapInvoice.groupBy({
    by: ["cardCode"],
    where: {
      cardCode: { in: codes },
      cancelled: false,
      docDate: { gte: since },
    },
    _sum: { docTotal: true },
  });

  for (const g of grouped) {
    map.set(g.cardCode, g._sum.docTotal ?? 0);
  }
  return map;
}
