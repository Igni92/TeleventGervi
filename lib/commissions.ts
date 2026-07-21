/**
 * COMMISSIONS COMMERCIALES — moteur UNIQUE, payées MENSUELLEMENT.
 *
 * Décision direction (07/2026) : « les commissions doivent être mises sur le
 * salaire et payées tous les mois au fur et à mesure ». L'unité de paie est
 * donc LE MOIS :
 *
 *   prime(mois) = taux × max(0, Σ max(0, marge nette de chaque facture du mois,
 *                 cadeaux neutralisés) − marge des avoirs du mois)
 *
 * Un mois négatif paie 0 (pas de déficit reporté). La prime cumulée affichée
 * (page Effectif, détail commissions) = Σ des primes mensuelles — exactement
 * ce qui est versé sur les bulletins.
 *
 * Règles par facture (identiques partout) :
 *   • cadeaux neutralisés (ligne produit offerte : 0 € / remise 100 %) ;
 *   • plancher 0 par facture ;
 *   • transport PAR POSITION via lib/transportDoc (transporteur réel du doc,
 *     repli tournée ; règle « magasin IDF = direct »).
 *
 * Consommateurs : /api/pilotage/commissions (détail), /api/commerciaux/sap
 * (page Effectif), /api/salaires (ligne de prime AUTOMATIQUE du mois).
 */
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { segmentOfGroup } from "@/lib/segments";
import { emailFromInitials } from "@/lib/salespeople";
import { loadDocTransportContext, docTransportCost, GIFT_LINE_SQL } from "@/lib/transportDoc";
import {
  PRIME_DEFAULT_RATE, PRIME_DEFAULT_START, r2, monthOf,
  primeRateOf, commissionMonths, selectPayslipMonths,
  type CommissionInvoice, type CommissionCreditNote, type CommissionMonth, type PayslipCommission,
} from "@/lib/commissionsCalc";

// Réexports : les consommateurs importent tout depuis lib/commissions.
export {
  PRIME_DEFAULT_RATE, PRIME_DEFAULT_START, primeRateOf, commissionMonths, prevMonth, selectPayslipMonths,
} from "@/lib/commissionsCalc";
export type {
  CommissionInvoice, CommissionCreditNote, CommissionMonth, PayslipCommission,
} from "@/lib/commissionsCalc";
/** id de la ligne de prime automatique — défini dans lib/salaires (client-safe). */
export { COMMISSION_PRIME_ID } from "@/lib/salaires";

/** Config de prime par commercial (table optionnelle → défauts silencieux). */
export async function loadPrimeConfig(): Promise<Map<string, { rate: number; since: Date }>> {
  const cfg = new Map<string, { rate: number; since: Date }>();
  try {
    const rows = await prisma.$queryRaw<{ slp: string; rate: number; since: Date }[]>(Prisma.sql`
      SELECT "slpName" AS slp, "rate"::float AS rate, "since" FROM "CommercialPrime"`);
    for (const r of rows) cfg.set(r.slp, { rate: Number(r.rate), since: new Date(r.since) });
  } catch { /* table absente → défauts */ }
  return cfg;
}

/**
 * Données de commission FACTURE PAR FACTURE (+ avoirs) depuis la date de début
 * de prime de chaque commercial. `slpFilter` restreint à UN commercial
 * (périmètre non-admin ou détail) ; null = tous.
 */
export async function commissionData(slpFilter: string | null): Promise<{
  cfg: Map<string, { rate: number; since: Date }>;
  invoices: CommissionInvoice[];
  creditNotes: CommissionCreditNote[];
}> {
  const slpCond = slpFilter ? Prisma.sql`AND c."commercial" = ${slpFilter}` : Prisma.empty;

  const [cfg, invRows, cnRows] = await Promise.all([
    loadPrimeConfig(),
    prisma.$queryRaw<{
      slp: string; de: number; dn: number | null; dd: Date; card: string; name: string | null;
      total: number; marge: number; mcad: number; cid: string; zip: string | null;
      trsp: string | null; gc: number | null; gn: string | null; kg: number;
    }[]>(Prisma.sql`
      SELECT c."commercial" AS slp, i."docEntry" AS de, i."docNum" AS dn, i."docDate" AS dd,
             i."cardCode" AS card, i."cardName" AS name, i."docTotal"::float AS total,
             COALESCE(i."grossProfit", 0)::float AS marge,
             COALESCE(SUM(l."grossProfit") FILTER (WHERE ${Prisma.raw(GIFT_LINE_SQL)}), 0)::float AS mcad,
             c."id" AS cid, c."zipCode" AS zip, i."trspCode" AS trsp,
             sbp."groupCode" AS gc, sbp."groupName" AS gn,
             COALESCE(SUM(l."quantity" * COALESCE(p."salesUnitWeight", 0)), 0)::float AS kg
      FROM "SapInvoice" i
      JOIN "Client" c ON c."code" = i."cardCode"
      LEFT JOIN "SapBusinessPartner" sbp ON sbp."cardCode" = i."cardCode"
      LEFT JOIN "CommercialPrime" pr ON pr."slpName" = c."commercial"
      LEFT JOIN "SapInvoiceLine" l ON l."docEntry" = i."docEntry"
      LEFT JOIN "Product" p ON p."itemCode" = l."itemCode"
      WHERE i."cancelled" = false
        AND c."commercial" IS NOT NULL AND c."commercial" <> ''
        AND i."docDate" >= COALESCE(pr."since", ${PRIME_DEFAULT_START})
        ${slpCond}
      GROUP BY 1, i."docEntry", c."id", sbp."cardCode"
      ORDER BY i."docDate" DESC, i."docEntry" DESC`),
    prisma.$queryRaw<{
      slp: string; de: number; dn: number | null; dd: Date; card: string; name: string | null;
      total: number; marge: number;
    }[]>(Prisma.sql`
      SELECT c."commercial" AS slp, n."docEntry" AS de, n."docNum" AS dn, n."docDate" AS dd,
             n."cardCode" AS card, n."cardName" AS name, n."docTotal"::float AS total,
             COALESCE(n."grossProfit", 0)::float AS marge
      FROM "SapCreditNote" n
      JOIN "Client" c ON c."code" = n."cardCode"
      LEFT JOIN "CommercialPrime" pr ON pr."slpName" = c."commercial"
      WHERE n."cancelled" = false
        AND c."commercial" IS NOT NULL AND c."commercial" <> ''
        AND n."docDate" >= COALESCE(pr."since", ${PRIME_DEFAULT_START})
        ${slpCond}
      ORDER BY n."docDate" DESC, n."docEntry" DESC`),
  ]);

  const ctx = await loadDocTransportContext(invRows.map((r) => r.card));

  const invoices: CommissionInvoice[] = invRows.map((r) => {
    const kg = Number(r.kg);
    const cadeaux = Math.max(0, -Number(r.mcad));
    const margeBrute = Number(r.marge) - Number(r.mcad); // cadeaux neutralisés
    const t = docTransportCost(ctx, {
      cardCode: r.card, clientId: r.cid, zip: r.zip, kg, trspCode: r.trsp,
      segment: segmentOfGroup(r.gn, r.gc),
    });
    const margeNette = margeBrute - t.cost;
    return {
      slp: r.slp,
      docEntry: r.de,
      docNum: r.dn,
      docDate: r.dd,
      month: monthOf(r.dd),
      cardCode: r.card,
      cardName: r.name,
      caHt: Number(r.total),
      margeBrute: r2(margeBrute),
      cadeaux: r2(cadeaux),
      kg,
      transport: r2(t.cost),
      carrier: t.carrier,
      mode: t.mode,
      fromDoc: t.fromDoc,
      margeNette: r2(margeNette),
      plancher: margeNette < 0,
    };
  });

  const creditNotes: CommissionCreditNote[] = cnRows.map((r) => ({
    slp: r.slp,
    docEntry: r.de,
    docNum: r.dn,
    docDate: r.dd,
    month: monthOf(r.dd),
    cardCode: r.card,
    cardName: r.name,
    caHt: Number(r.total),
    margeBrute: Number(r.marge),
  }));

  return { cfg, invoices, creditNotes };
}

/**
 * COMMISSION À VERSER sur la paie du mois `monthId`, par EMAIL de salarié.
 *
 * Payée mensuellement : on cumule la commission des mois de la plage
 * (curseur, monthId]. `paidThrough` = dernier mois DÉJÀ réglé (null = rien).
 * Le curseur effectif est borné à `prevMonth(monthId)` : ainsi, même après
 * avoir marqué le mois courant réglé (envoi/rectif), la paie du mois courant
 * garde SA propre commission — jamais un rattrapage vidé à tort.
 */
export async function commissionsForPayslip(
  monthId: string,
  paidThrough: string | null,
): Promise<Map<string, PayslipCommission>> {
  const out = new Map<string, PayslipCommission>();
  try {
    const { cfg, invoices, creditNotes } = await commissionData(null);
    const slps = new Set<string>([...invoices.map((f) => f.slp), ...creditNotes.map((n) => n.slp)]);
    for (const slp of slps) {
      const email = emailFromInitials(slp)?.toLowerCase();
      if (!email) continue;
      const rate = primeRateOf(cfg, slp);
      // Mois de la plage à régler : (curseur, monthId].
      const months = selectPayslipMonths(
        commissionMonths(
          invoices.filter((f) => f.slp === slp),
          creditNotes.filter((n) => n.slp === slp),
          rate,
        ),
        monthId,
        paidThrough,
      );
      if (months.length === 0) continue;
      const base = months.reduce((s, m) => s + m.base, 0);
      const prime = Math.round(months.reduce((s, m) => s + m.prime, 0) * 100) / 100;
      if (prime <= 0) continue;
      const sorted = months.map((m) => m.month).sort();
      out.set(email, {
        slp, rate,
        base: Math.round(base * 100) / 100,
        prime,
        fromMonth: sorted[0],
        toMonth: monthId,
        monthsCount: months.length,
      });
    }
  } catch { /* moteur indisponible → pas de ligne auto (jamais bloquant pour la paie) */ }
  return out;
}
