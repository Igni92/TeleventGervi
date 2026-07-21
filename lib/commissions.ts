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
import {
  loadDocTransportContext, docTransportCost, GIFT_LINE_SQL,
  type DocTransportMode,
} from "@/lib/transportDoc";

export const PRIME_DEFAULT_RATE = 0.05;
export const PRIME_DEFAULT_START = new Date(Date.UTC(2025, 10, 1)); // 1ᵉʳ novembre 2025

/** id de la ligne de prime automatique — défini dans lib/salaires (client-safe),
 *  ré-exporté ici pour les consommateurs serveur. */
export { COMMISSION_PRIME_ID } from "@/lib/salaires";

export interface CommissionInvoice {
  slp: string;
  docEntry: number;
  docNum: number | null;
  docDate: Date;
  /** Mois de rattachement (YYYY-MM, date de facture). */
  month: string;
  cardCode: string;
  cardName: string | null;
  caHt: number;
  /** Marge brute CORRIGÉE des cadeaux. */
  margeBrute: number;
  /** Coût des lignes cadeaux neutralisé (≥ 0). */
  cadeaux: number;
  kg: number;
  transport: number;
  carrier: string | null;
  mode: DocTransportMode;
  fromDoc: boolean;
  margeNette: number;
  plancher: boolean;
}

export interface CommissionCreditNote {
  slp: string;
  docEntry: number;
  docNum: number | null;
  docDate: Date;
  month: string;
  cardCode: string;
  cardName: string | null;
  caHt: number;
  margeBrute: number;
}

export interface CommissionMonth {
  month: string;              // YYYY-MM
  invoices: number;
  creditNotes: number;
  /** Σ max(0, marge nette facture) du mois. */
  basePositive: number;
  /** Marge reprise par les avoirs du mois. */
  avoirs: number;
  /** Base RETENUE du mois = max(0, basePositive − avoirs). */
  base: number;
  /** Prime du mois = taux × base — le montant versé sur le bulletin. */
  prime: number;
}

const r2 = (v: number) => Math.round(v * 100) / 100;
const monthOf = (d: Date) => d.toISOString().slice(0, 7);

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

export function primeRateOf(cfg: Map<string, { rate: number; since: Date }>, slp: string): number {
  return cfg.get(slp)?.rate ?? PRIME_DEFAULT_RATE;
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
 * Découpage MENSUEL (l'unité de paie) pour les documents d'UN commercial —
 * mois triés du plus récent au plus ancien.
 */
export function commissionMonths(
  invoices: CommissionInvoice[],
  creditNotes: CommissionCreditNote[],
  rate: number,
): CommissionMonth[] {
  const byMonth = new Map<string, { inv: number; cn: number; pos: number; avoirs: number }>();
  const bucket = (m: string) => {
    let b = byMonth.get(m);
    if (!b) { b = { inv: 0, cn: 0, pos: 0, avoirs: 0 }; byMonth.set(m, b); }
    return b;
  };
  for (const f of invoices) {
    const b = bucket(f.month);
    b.inv += 1;
    b.pos += Math.max(0, f.margeNette); // plancher 0 par facture
  }
  for (const n of creditNotes) {
    const b = bucket(n.month);
    b.cn += 1;
    b.avoirs += n.margeBrute;
  }
  return [...byMonth.entries()]
    .sort((a, b) => b[0].localeCompare(a[0]))
    .map(([month, b]) => {
      const base = Math.max(0, b.pos - b.avoirs); // pas de déficit reporté
      return {
        month,
        invoices: b.inv,
        creditNotes: b.cn,
        basePositive: r2(b.pos),
        avoirs: r2(b.avoirs),
        base: r2(base),
        prime: r2(base * rate),
      };
    });
}

/**
 * PRIME DU MOIS par EMAIL de salarié — la ligne de prime automatique des
 * éléments de salaires (id COMMISSION_PRIME_ID). Ne renvoie que les
 * commerciaux rattachés à un compte, avec une prime > 0 sur le mois.
 */
export async function commissionsOfMonthByEmail(monthId: string): Promise<
  Map<string, { slp: string; rate: number; base: number; prime: number }>
> {
  const out = new Map<string, { slp: string; rate: number; base: number; prime: number }>();
  try {
    const { cfg, invoices, creditNotes } = await commissionData(null);
    const slps = new Set(invoices.map((f) => f.slp));
    for (const n of creditNotes) slps.add(n.slp);
    for (const slp of slps) {
      const email = emailFromInitials(slp)?.toLowerCase();
      if (!email) continue;
      const rate = primeRateOf(cfg, slp);
      const m = commissionMonths(
        invoices.filter((f) => f.slp === slp),
        creditNotes.filter((n) => n.slp === slp),
        rate,
      ).find((x) => x.month === monthId);
      if (m && m.prime > 0) out.set(email, { slp, rate, base: m.base, prime: m.prime });
    }
  } catch { /* moteur indisponible → pas de ligne auto (jamais bloquant pour la paie) */ }
  return out;
}
