/**
 * Agrégats pilotage — calculs sur le miroir SAP local.
 *
 * Granularité supportée : day | week | month | year. La période courante est
 * comparée à la même période N-1 (YoY) — cf. [[dashboard-comparatif-yoy]].
 *
 * NB : on filtre `cancelled: false` sur Invoices / Orders / PDN pour exclure
 *      les annulations comptables.
 *
 * ⚠️ MARGE RÉELLE (directive juin 2026) : plus AUCUN KPI ne lit la marge SAP
 *    (`grossProfit` / `lineCost` restent en base mais sont ignorés). Toute
 *    marge est recalculée depuis le coût réel d'entrée marchandise — cf.
 *    lib/cogs.ts (LATERAL sur SapPdnLine, fallback première EM, couverture).
 */

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { familyOf } from "@/lib/familles";
import { grossMarginPct } from "@/lib/margin";
import {
  COGS_MARGIN, COGS_PRODUCT_LINES, COGS_COSTED_LINES,
  cogsFromSql, realMarginAgg,
} from "@/lib/cogs";

export type { Granularity } from "@/lib/pilotage-time";
export { periodBounds, previousYearBounds } from "@/lib/pilotage-time";
import { ANNUAL_MATRIX_YEARS_BACK } from "@/lib/pilotage-time";

/* ─────────────────────────────────────────────────────────────────
   Filtre segment — restreint un agrégat aux clients dont le groupe SAP
   (SapBusinessPartner.groupCode) appartient au segment (cf. lib/segments).
   `alias` = alias SQL de la table document (ex. "i" pour SapInvoice).
   null/undefined = pas de filtre.
   ───────────────────────────────────────────────────────────────── */
function segmentSql(alias: string, groupCodes?: number[] | null): Prisma.Sql {
  if (!groupCodes || groupCodes.length === 0) return Prisma.empty;
  return Prisma.sql`AND EXISTS (
    SELECT 1 FROM "SapBusinessPartner" sbp
    WHERE sbp."cardCode" = ${Prisma.raw(`${alias}."cardCode"`)}
      AND sbp."groupCode" IN (${Prisma.join(groupCodes)}))`;
}

/** Variante Prisma (requêtes non-raw) du même filtre segment. */
function segmentWhere(groupCodes?: number[] | null): { bp: { groupCode: { in: number[] } } } | Record<string, never> {
  return groupCodes && groupCodes.length > 0 ? { bp: { groupCode: { in: groupCodes } } } : {};
}

/* ─────────────────────────────────────────────────────────────────
   Scoping commercial (droits) — restreint un agrégat aux documents d'un
   seul `slpName`. `null`/`undefined` = AUCUN filtre = vision globale (admin) :
   le comportement historique est strictement préservé pour les admins.
   `alias` = alias SQL de la table document (ex. "i" pour SapInvoice).
   ───────────────────────────────────────────────────────────────── */
function slpSql(alias: string, slpName?: string | null): Prisma.Sql {
  if (!slpName) return Prisma.empty;
  return Prisma.sql`AND ${Prisma.raw(`${alias}."slpName"`)} = ${slpName}`;
}

/** Variante Prisma (requêtes typées) du filtre commercial. */
function slpWhere(slpName?: string | null): { slpName: string } | Record<string, never> {
  return slpName ? { slpName } : {};
}

/** Périmètre CRM d'un commercial : IDs des clients qu'il suit par `commercial`
 *  (account manager) OU `vendeur` (réalité terrain — cf. console #18, décision
 *  métier « commercial OU vendeur »). `vendeur` n'étant pas dans le client
 *  Prisma typé, on résout les IDs en raw SQL puis on filtre par `clientId IN`.
 *  null/undefined = AUCUN filtre (admin, vision globale — comportement
 *  historique strictement préservé). */
async function clientIdsForOwner(slpName?: string | null): Promise<string[] | null> {
  if (!slpName) return null;
  const rows = await prisma.$queryRaw<{ id: string }[]>(
    Prisma.sql`SELECT "id" FROM "Client" WHERE "commercial" = ${slpName} OR "vendeur" = ${slpName}`,
  );
  return rows.map((r) => r.id);
}

/* ─────────────────────────────────────────────────────────────────
   Tops — clients (CA + marge), fournisseurs (valeur PDN), commerciaux (CA).
   ───────────────────────────────────────────────────────────────── */

export interface TopClient {
  cardCode: string;
  cardName: string | null;
  ca: number;
  /** CA produit NET (hors services) — base de la marge BRUTE % (≠ ca total). */
  caProductNet: number;
  margin: number;
  invoices: number;
}

/** Marge brute (coût EM) + CA produit NET par clé (cardCode ou slpName),
 *  Invoices − Avoirs, restreints aux clés du top (≤ qq dizaines) — 2 GROUP BY
 *  SQL ciblés. La marge % se calcule ensuite via grossMarginPct(margin, cpn). */
async function realMarginByKey(
  keyCol: "cardCode" | "slpName",
  keys: string[],
  start: Date,
  end: Date,
  groupCodes?: number[] | null,
  slpName?: string | null,
): Promise<Map<string, { margin: number; caProductNet: number }>> {
  if (keys.length === 0) return new Map();
  const col = Prisma.raw(`i."${keyCol}"`);
  const q = (kind: "invoice" | "creditNote") =>
    prisma.$queryRaw<{ k: string; m: number; cpn: number }[]>(Prisma.sql`
      SELECT ${col} AS k, COALESCE(SUM(${COGS_MARGIN}), 0)::float AS m,
             COALESCE(SUM(l."lineTotal") FILTER (WHERE l."isService" = false), 0)::float AS cpn
      FROM ${cogsFromSql(kind)}
      WHERE i."cancelled" = false AND i."docDate" >= ${start} AND i."docDate" < ${end}
        AND ${col} IN (${Prisma.join(keys)}) ${segmentSql("i", groupCodes)} ${slpSql("i", slpName)}
      GROUP BY 1`);
  const [inv, cn] = await Promise.all([q("invoice"), q("creditNote")]);
  const m = new Map<string, { margin: number; caProductNet: number }>();
  for (const r of inv) m.set(r.k, { margin: Number(r.m), caProductNet: Number(r.cpn) });
  for (const r of cn) {
    const cur = m.get(r.k) ?? { margin: 0, caProductNet: 0 };
    m.set(r.k, { margin: cur.margin - Number(r.m), caProductNet: cur.caProductNet - Number(r.cpn) });
  }
  return m;
}

export async function topClients(start: Date, end: Date, limit = 10, groupCodes?: number[] | null, slpName?: string | null): Promise<TopClient[]> {
  const grouped = await prisma.sapInvoice.groupBy({
    by: ["cardCode"],
    where: { docDate: { gte: start, lt: end }, cancelled: false, ...segmentWhere(groupCodes), ...slpWhere(slpName) },
    _sum: { docTotal: true },
    _count: { docEntry: true },
    orderBy: { _sum: { docTotal: "desc" } },
    take: limit,
  });
  const codes = grouped.map((g) => g.cardCode);
  const [names, margins] = await Promise.all([
    prisma.sapBusinessPartner.findMany({
      where: { cardCode: { in: codes } },
      select: { cardCode: true, cardName: true },
    }),
    // Marge réelle (coût EM) restreinte aux clients du top — pas le gp SAP.
    realMarginByKey("cardCode", codes, start, end, groupCodes, slpName),
  ]);
  const nameMap = new Map(names.map((n) => [n.cardCode, n.cardName]));

  return grouped.map((g) => {
    const md = margins.get(g.cardCode);
    return {
      cardCode: g.cardCode,
      cardName: nameMap.get(g.cardCode) ?? null,
      ca: g._sum.docTotal ?? 0,
      caProductNet: md?.caProductNet ?? 0,
      margin: md?.margin ?? 0,
      invoices: g._count.docEntry,
    };
  });
}

export interface TopSupplier {
  cardCode: string;
  cardName: string | null;
  /** Achats NET HT = Σ EM (PurchaseDeliveryNotes) − Σ avoirs fournisseurs (PurchaseReturns). */
  totalIn: number;
  pdnCount: number;
}

export async function topSuppliers(start: Date, end: Date, limit = 10): Promise<TopSupplier[]> {
  // Achats NET = Σ EM − Σ retours fournisseurs (avoirs). On agrège les deux
  // entités par fournisseur puis on net AVANT le classement : un gros volume
  // d'avoirs peut faire reculer un fournisseur dans le top.
  const [pdn, returns] = await Promise.all([
    prisma.sapPurchaseDeliveryNote.groupBy({
      by: ["cardCode"],
      where: { docDate: { gte: start, lt: end }, cancelled: false },
      _sum: { docTotal: true },
      _count: { docEntry: true },
    }),
    prisma.sapPurchaseReturn.groupBy({
      by: ["cardCode"],
      where: { docDate: { gte: start, lt: end }, cancelled: false },
      _sum: { docTotal: true },
    }),
  ]);
  const returnByCard = new Map(returns.map((r) => [r.cardCode, r._sum.docTotal ?? 0]));

  const ranked = pdn
    .map((g) => ({
      cardCode: g.cardCode,
      totalIn: (g._sum.docTotal ?? 0) - (returnByCard.get(g.cardCode) ?? 0),
      pdnCount: g._count.docEntry,
    }))
    .sort((a, b) => b.totalIn - a.totalIn)
    .slice(0, limit);

  const names = await prisma.sapBusinessPartner.findMany({
    where: { cardCode: { in: ranked.map((g) => g.cardCode) } },
    select: { cardCode: true, cardName: true },
  });
  const nameMap = new Map(names.map((n) => [n.cardCode, n.cardName]));

  return ranked.map((g) => ({
    cardCode: g.cardCode,
    cardName: nameMap.get(g.cardCode) ?? null,
    totalIn: g.totalIn,
    pdnCount: g.pdnCount,
  }));
}

export interface TopSalesperson {
  slpName: string;
  ca: number;
  /** CA produit NET (hors services) — base de la marge BRUTE % (≠ ca total). */
  caProductNet: number;
  margin: number;
  activeClients: number;
  invoices: number;
}

/* ═════════════════════════════════════════════════════════════════
   ACTIVITÉ COMMERCIALE (BL / Orders) — pour Écran 1 cockpit live.
   Source : SapOrder + SapOrderLine. NE PAS confondre avec le CA comptable.
   Marge RÉELLE par ligne : Σ (lineTotal − quantity × coût_EM) — coût issu
   de la dernière entrée marchandise (lib/cogs), PAS le lineCost SAP.
   Si aucun coût EM n'est connu pour l'article, la ligne contribue au volume
   mais pas à la marge (comptée dans marginCoverage — affichage transparent).
   ═════════════════════════════════════════════════════════════════ */

export interface ActivityBucket {
  volume: number;         // Σ DocTotal HT des Orders non annulés (= CA HT BL)
  caProductNet: number;   // Σ lineTotal des lignes produit (isService=false) — base marge %
  weightKg: number;       // Σ quantity × salesUnitWeight par ligne (= Volume kg)
  margin: number;         // Σ (lineTotal − quantity × coût_EM) par ligne (lib/cogs)
  marginPct: number;      // marge BRUTE / CA produit NET × 100 (base unique lib/margin)
  marginCoverage: number; // % des lignes produit dont le coût EM est résolu (qualité données)
  ordersCount: number;
  activeClients: number;
  avgBasket: number;
}

export async function aggregateActivity(start: Date, end: Date, slpName?: string | null): Promise<ActivityBucket> {
  // 2 requêtes SQL agrégées (en-têtes + lignes) — on ne rapatrie plus les
  // milliers de lignes en JS : SUM/COUNT côté Postgres. Le coût vient du
  // LATERAL EM (lib/cogs), alias i = SapOrder, l = SapOrderLine.
  const slpHdr = slpName ? Prisma.sql`AND "slpName" = ${slpName}` : Prisma.empty;
  const [[hdr], [ln]] = await Promise.all([
    prisma.$queryRaw<{ volume: number; orders: number; clients: number }[]>(Prisma.sql`
      SELECT COALESCE(SUM("docTotal"), 0)::float AS volume,
             COUNT(*)::int AS orders,
             COUNT(DISTINCT "cardCode")::int AS clients
      FROM "SapOrder"
      WHERE "cancelled" = false AND "docDate" >= ${start} AND "docDate" < ${end} ${slpHdr}`),
    prisma.$queryRaw<{ n: number; with_cost: number; margin: number; weight: number; ca_product: number }[]>(Prisma.sql`
      SELECT ${COGS_PRODUCT_LINES}::int AS n,
             ${COGS_COSTED_LINES}::int AS with_cost,
             COALESCE(SUM(${COGS_MARGIN}), 0)::float AS margin,
             COALESCE(SUM(l."quantity" * COALESCE(p."salesUnitWeight", 0)), 0)::float AS weight,
             COALESCE(SUM(l."lineTotal") FILTER (WHERE l."isService" = false), 0)::float AS ca_product
      FROM ${cogsFromSql("order")}
      LEFT JOIN "Product" p ON p."itemCode" = l."itemCode"
      WHERE i."cancelled" = false AND i."docDate" >= ${start} AND i."docDate" < ${end} ${slpSql("i", slpName)}`),
  ]);

  const volume = Number(hdr?.volume ?? 0);
  const ordersCount = Number(hdr?.orders ?? 0);
  const margin = Number(ln?.margin ?? 0);
  const linesCount = Number(ln?.n ?? 0);
  const caProductNet = Number(ln?.ca_product ?? 0);

  return {
    volume,
    caProductNet,
    weightKg: Number(ln?.weight ?? 0),
    margin,
    // Marge BRUTE % sur le CA produit NET (hors services), pas sur le volume BL
    // total — alignée sur l'écran 2 / la matrice annuelle (base unique lib/margin).
    marginPct: grossMarginPct(margin, caProductNet),
    marginCoverage: linesCount > 0 ? (Number(ln?.with_cost ?? 0) / linesCount) * 100 : 0,
    ordersCount,
    activeClients: Number(hdr?.clients ?? 0),
    avgBasket: ordersCount > 0 ? volume / ordersCount : 0,
  };
}

export interface TopClientOrder {
  cardCode: string;
  cardName: string | null;
  volume: number;
  orders: number;
}

export async function topClientsOrder(start: Date, end: Date, limit = 10, slpName?: string | null): Promise<TopClientOrder[]> {
  const grouped = await prisma.sapOrder.groupBy({
    by: ["cardCode"],
    where: { docDate: { gte: start, lt: end }, cancelled: false, ...slpWhere(slpName) },
    _sum: { docTotal: true },
    _count: { docEntry: true },
    orderBy: { _sum: { docTotal: "desc" } },
    take: limit,
  });
  const names = await prisma.sapBusinessPartner.findMany({
    where: { cardCode: { in: grouped.map((g) => g.cardCode) } },
    select: { cardCode: true, cardName: true },
  });
  const nameMap = new Map(names.map((n) => [n.cardCode, n.cardName]));
  return grouped.map((g) => ({
    cardCode: g.cardCode,
    cardName: nameMap.get(g.cardCode) ?? null,
    volume: g._sum.docTotal ?? 0,
    orders: g._count.docEntry,
  }));
}

export interface TopSalespersonOrder {
  slpName: string;
  volume: number;
  orders: number;
  activeClients: number;
}

export async function topSalespersonsOrder(start: Date, end: Date, limit = 10): Promise<TopSalespersonOrder[]> {
  const grouped = await prisma.sapOrder.groupBy({
    by: ["slpName"],
    where: { docDate: { gte: start, lt: end }, cancelled: false, slpName: { not: null } },
    _sum: { docTotal: true },
    _count: { docEntry: true },
    orderBy: { _sum: { docTotal: "desc" } },
    take: limit,
  });
  const slpNames = grouped.flatMap((g) => (g.slpName ? [g.slpName] : []));

  // # clients actifs distincts par commercial — UNE requête (était N+1 :
  // un findMany distinct par commercial). COUNT(DISTINCT cardCode) GROUP BY slpName
  // sur les mêmes filtres (range + cancelled), restreint au top N.
  const active = slpNames.length > 0
    ? await prisma.$queryRaw<{ k: string; n: number }[]>(Prisma.sql`
        SELECT o."slpName" AS k, COUNT(DISTINCT o."cardCode")::int AS n
        FROM "SapOrder" o
        WHERE o."cancelled" = false AND o."docDate" >= ${start} AND o."docDate" < ${end}
          AND o."slpName" IN (${Prisma.join(slpNames)})
        GROUP BY 1`)
    : [];
  const activeMap = new Map(active.map((r) => [r.k, Number(r.n)]));

  const out: TopSalespersonOrder[] = [];
  for (const g of grouped) {
    if (!g.slpName) continue;
    out.push({
      slpName: g.slpName,
      volume: g._sum.docTotal ?? 0,
      orders: g._count.docEntry,
      activeClients: activeMap.get(g.slpName) ?? 0,
    });
  }
  return out;
}

/* ═════════════════════════════════════════════════════════════════
   RAPPORT ANNUEL (Invoices) — pour Écran 2 rétrospectif.
   Matrice mois × N années (typiquement 3 : N-2, N-1, N).
   Renvoie pour chaque cellule : CA HT + Marge RÉELLE (coût EM, lib/cogs).
   ═════════════════════════════════════════════════════════════════ */

export interface YearMonthlyData {
  year: number;
  months: { ca: number; margin: number; weightKg: number; caProductNet: number }[];   // length=12, Jan→Déc
  totalCa: number;
  totalMargin: number;
  totalWeightKg: number;
  /** CA produit (hors services) cumulé — base correcte pour Marge % annuelle. */
  totalCaProductNet: number;
}

/**
 * Matrice annuelle Invoices : pour chaque (année, mois) on calcule CA + marge
 * + poids total (kg). Le poids est dérivé des Product.salesUnitWeight
 * (SAP Item.SalesUnitWeight, en kg par unité de vente).
 *
 * Le poids permet à la UI de basculer entre vue €€ et vue kg/t —
 * cf. toggle CA HT / Poids sur PilotageScreen2.
 *
 * Perf : 8 GROUP BY (année, mois) en parallèle sur toute la fenêtre — PAS une
 * boucle de 36 mois × 6 agrégats (l'ancienne version = ~216 requêtes/écran).
 * La marge n'est plus le grossProfit SAP mais le coût EM réel (lib/cogs),
 * agrégée à la ligne et regroupée par mois en deux requêtes dédiées.
 */
export async function annualMatrix(yearsBack = ANNUAL_MATRIX_YEARS_BACK, groupCodes?: number[] | null, slpName?: string | null): Promise<YearMonthlyData[]> {
  const currentYear = new Date().getFullYear();
  const firstYear = currentYear - yearsBack;
  const start = new Date(firstYear, 0, 1);
  const end = new Date(currentYear + 1, 0, 1);
  const seg = segmentSql("i", groupCodes);
  const slp = slpSql("i", slpName);

  // Chaque requête renvoie (année, mois 1..12, a). CA et marge sont agrégés
  // séparément : la marge réelle se calcule à la ligne (LATERAL EM) tandis que
  // le CA reste en en-tête — les joindre dupliquerait docTotal par ligne.
  type Row1 = { y: number; m: number; a: number };
  const ym = Prisma.sql`EXTRACT(YEAR FROM i."docDate")::int AS y, EXTRACT(MONTH FROM i."docDate")::int AS m`;
  // Le filtre commercial est replié dans `range` → appliqué aux 8 agrégats.
  const range = Prisma.sql`i."docDate" >= ${start} AND i."docDate" < ${end}${slp}`;

  const [invCa, cnCa, invMargin, cnMargin, invWeight, cnWeight, invProduct, cnProduct] = await Promise.all([
    // CA HT (Invoices) / à déduire (Avoirs) — agrégat en-tête
    prisma.$queryRaw<Row1[]>(Prisma.sql`
      SELECT ${ym}, COALESCE(SUM(i."docTotal"), 0)::float AS a
      FROM "SapInvoice" i
      WHERE i."cancelled" = false AND ${range} ${seg}
      GROUP BY 1, 2`),
    prisma.$queryRaw<Row1[]>(Prisma.sql`
      SELECT ${ym}, COALESCE(SUM(i."docTotal"), 0)::float AS a
      FROM "SapCreditNote" i
      WHERE i."cancelled" = false AND ${range} ${seg}
      GROUP BY 1, 2`),
    // Marge RÉELLE (coût EM, lib/cogs) — agrégat ligne, regroupé par mois.
    // Plus AUCUN grossProfit SAP (directive juin 2026).
    prisma.$queryRaw<Row1[]>(Prisma.sql`
      SELECT ${ym}, COALESCE(SUM(${COGS_MARGIN}), 0)::float AS a
      FROM ${cogsFromSql("invoice")}
      WHERE i."cancelled" = false AND ${range} ${seg}
      GROUP BY 1, 2`),
    prisma.$queryRaw<Row1[]>(Prisma.sql`
      SELECT ${ym}, COALESCE(SUM(${COGS_MARGIN}), 0)::float AS a
      FROM ${cogsFromSql("creditNote")}
      WHERE i."cancelled" = false AND ${range} ${seg}
      GROUP BY 1, 2`),
    // Poids (kg) : lignes × Product.salesUnitWeight (lignes service → poids 0)
    prisma.$queryRaw<Row1[]>(Prisma.sql`
      SELECT ${ym}, COALESCE(SUM(l."quantity" * COALESCE(p."salesUnitWeight", 0)), 0)::float AS a
      FROM "SapInvoiceLine" l
      JOIN "SapInvoice" i ON i."docEntry" = l."docEntry"
      LEFT JOIN "Product" p ON p."itemCode" = l."itemCode"
      WHERE i."cancelled" = false AND ${range} ${seg}
      GROUP BY 1, 2`),
    prisma.$queryRaw<Row1[]>(Prisma.sql`
      SELECT ${ym}, COALESCE(SUM(l."quantity" * COALESCE(p."salesUnitWeight", 0)), 0)::float AS a
      FROM "SapCreditNoteLine" l
      JOIN "SapCreditNote" i ON i."docEntry" = l."docEntry"
      LEFT JOIN "Product" p ON p."itemCode" = l."itemCode"
      WHERE i."cancelled" = false AND ${range} ${seg}
      GROUP BY 1, 2`),
    // CA produit NET (lignes isService=false) — base du calcul Marge %
    prisma.$queryRaw<Row1[]>(Prisma.sql`
      SELECT ${ym}, COALESCE(SUM(l."lineTotal"), 0)::float AS a
      FROM "SapInvoiceLine" l
      JOIN "SapInvoice" i ON i."docEntry" = l."docEntry"
      WHERE i."cancelled" = false AND l."isService" = false AND ${range} ${seg}
      GROUP BY 1, 2`),
    prisma.$queryRaw<Row1[]>(Prisma.sql`
      SELECT ${ym}, COALESCE(SUM(l."lineTotal"), 0)::float AS a
      FROM "SapCreditNoteLine" l
      JOIN "SapCreditNote" i ON i."docEntry" = l."docEntry"
      WHERE i."cancelled" = false AND l."isService" = false AND ${range} ${seg}
      GROUP BY 1, 2`),
  ]);

  // Assemblage : grille (année × 12 mois) à zéro puis application des deltas.
  const byYear = new Map<number, YearMonthlyData>();
  for (let y = firstYear; y <= currentYear; y++) {
    byYear.set(y, {
      year: y,
      months: Array.from({ length: 12 }, () => ({ ca: 0, margin: 0, weightKg: 0, caProductNet: 0 })),
      totalCa: 0, totalMargin: 0, totalWeightKg: 0, totalCaProductNet: 0,
    });
  }
  const apply = <R extends Row1>(rows: R[], fn: (mo: YearMonthlyData["months"][number], r: R) => void) => {
    for (const r of rows) {
      const mo = byYear.get(Number(r.y))?.months[Number(r.m) - 1];
      if (mo) fn(mo, r);
    }
  };
  apply(invCa, (mo, r) => { mo.ca += Number(r.a); });
  apply(cnCa, (mo, r) => { mo.ca -= Number(r.a); });
  apply(invMargin, (mo, r) => { mo.margin += Number(r.a); });
  apply(cnMargin, (mo, r) => { mo.margin -= Number(r.a); });
  apply(invWeight, (mo, r) => { mo.weightKg += Number(r.a); });
  // Avoirs = stock rendu = poids retiré du net
  apply(cnWeight, (mo, r) => { mo.weightKg -= Number(r.a); });
  apply(invProduct, (mo, r) => { mo.caProductNet += Number(r.a); });
  apply(cnProduct, (mo, r) => { mo.caProductNet -= Number(r.a); });

  const out = Array.from(byYear.values());
  for (const yd of out) {
    for (const mo of yd.months) {
      yd.totalCa += mo.ca;
      yd.totalMargin += mo.margin;
      yd.totalWeightKg += mo.weightKg;
      yd.totalCaProductNet += mo.caProductNet;
    }
  }
  return out.sort((a, b) => a.year - b.year);
}

/* ═════════════════════════════════════════════════════════════════
   SÉRIE HEBDOMADAIRE (Invoices − Avoirs) — par semaine ISO.
   Alimente le graphe d'évolution (n° de semaine) + l'onglet
   « semaines à événement » (lookup d'une semaine donnée N vs N-1).
   Raw SQL Postgres : EXTRACT(ISOYEAR/WEEK) = numérotation ISO 8601 native.
   ═════════════════════════════════════════════════════════════════ */

export interface WeeklyBucket {
  /** Année ISO (≠ calendaire en bordure déc/janv). */
  isoYear: number;
  /** Numéro de semaine ISO 1..53. */
  week: number;
  /** CA NET = Σ Invoices − Σ Avoirs sur la semaine. */
  ca: number;
  /** Marge NET RÉELLE = marge coût EM Invoices − Avoirs (lib/cogs, plus de grossProfit SAP). */
  margin: number;
}

/**
 * CA + marge NET agrégés par semaine ISO sur [from, to[. Le CA est agrégé en
 * en-tête (docTotal) ; la marge réelle se calcule à la ligne (LATERAL EM,
 * lib/cogs) — d'où 4 CTE (ca/marge × factures/avoirs) recollées sur la liste
 * de semaines `keys`. Les semaines sans activité ne sont pas renvoyées (la UI
 * comble les trous à 0 via le numéro de semaine).
 */
export async function weeklyInvoiceSeries(from: Date, to: Date, groupCodes?: number[] | null, slpName?: string | null): Promise<WeeklyBucket[]> {
  const seg = segmentSql("i", groupCodes);
  // Filtre commercial replié dans `range` → appliqué aux CTE CA et marge.
  const range = Prisma.sql`i."docDate" >= ${from} AND i."docDate" < ${to}${slpSql("i", slpName)}`;
  const isoWeekCols = Prisma.sql`EXTRACT(ISOYEAR FROM i."docDate")::int AS iso_year,
             EXTRACT(WEEK    FROM i."docDate")::int AS week`;
  // CA en en-tête (docTotal) — table SapInvoice / SapCreditNote.
  const caCte = (table: string) => Prisma.sql`
    SELECT ${isoWeekCols}, SUM(i."docTotal") AS v
    FROM ${Prisma.raw(`"${table}"`)} i
    WHERE i."cancelled" = false AND ${range} ${seg}
    GROUP BY 1, 2`;
  // Marge réelle coût EM (lib/cogs) — agrégée à la ligne via cogsFromSql.
  const marginCte = (kind: "invoice" | "creditNote") => Prisma.sql`
    SELECT ${isoWeekCols}, COALESCE(SUM(${COGS_MARGIN}), 0) AS v
    FROM ${cogsFromSql(kind)}
    WHERE i."cancelled" = false AND ${range} ${seg}
    GROUP BY 1, 2`;
  const rows = await prisma.$queryRaw<
    { iso_year: number; week: number; ca: number; margin: number }[]
  >(Prisma.sql`
    WITH inv_ca AS (${caCte("SapInvoice")}),
         cn_ca  AS (${caCte("SapCreditNote")}),
         inv_m  AS (${marginCte("invoice")}),
         cn_m   AS (${marginCte("creditNote")}),
         keys AS (
           SELECT iso_year, week FROM inv_ca
           UNION SELECT iso_year, week FROM cn_ca
           UNION SELECT iso_year, week FROM inv_m
           UNION SELECT iso_year, week FROM cn_m
         )
    SELECT k.iso_year, k.week,
           COALESCE(inv_ca.v, 0) - COALESCE(cn_ca.v, 0) AS ca,
           COALESCE(inv_m.v, 0)  - COALESCE(cn_m.v, 0)  AS margin
    FROM keys k
    LEFT JOIN inv_ca ON inv_ca.iso_year = k.iso_year AND inv_ca.week = k.week
    LEFT JOIN cn_ca  ON cn_ca.iso_year  = k.iso_year AND cn_ca.week  = k.week
    LEFT JOIN inv_m  ON inv_m.iso_year  = k.iso_year AND inv_m.week  = k.week
    LEFT JOIN cn_m   ON cn_m.iso_year   = k.iso_year AND cn_m.week   = k.week
    ORDER BY 1, 2;
  `);
  return rows.map((r) => ({
    isoYear: Number(r.iso_year),
    week: Number(r.week),
    ca: Number(r.ca),
    margin: Number(r.margin),
  }));
}

/* ─────────────────────────────────────────────────────────────────
   SÉRIE HEBDOMADAIRE D'ACTIVITÉ (Orders / BL) — pour les courbes Écran 1.
   Volume HT (docTotal) agrégé par semaine ISO. Source SapOrder (≠ Invoices).
   ───────────────────────────────────────────────────────────────── */

export interface WeeklyVolumeBucket {
  isoYear: number;
  week: number;
  volume: number;   // CA HT BL (Σ docTotal)
  weightKg: number; // Volume kg (Σ quantity × salesUnitWeight)
}

export async function weeklyOrderSeries(from: Date, to: Date, slpName?: string | null): Promise<WeeklyVolumeBucket[]> {
  const slpHdr = slpName ? Prisma.sql`AND "slpName" = ${slpName}` : Prisma.empty;
  const rows = await prisma.$queryRaw<
    { iso_year: number; week: number; volume: number; weight: number }[]
  >(Prisma.sql`
    WITH vol AS (
      SELECT EXTRACT(ISOYEAR FROM "docDate")::int AS iso_year,
             EXTRACT(WEEK    FROM "docDate")::int AS week,
             SUM("docTotal") AS volume
      FROM "SapOrder"
      WHERE "cancelled" = false AND "docDate" >= ${from} AND "docDate" < ${to} ${slpHdr}
      GROUP BY 1, 2
    ),
    wt AS (
      SELECT EXTRACT(ISOYEAR FROM o."docDate")::int AS iso_year,
             EXTRACT(WEEK    FROM o."docDate")::int AS week,
             SUM(l."quantity" * COALESCE(p."salesUnitWeight", 0)) AS weight
      FROM "SapOrderLine" l
      JOIN "SapOrder"   o ON o."docEntry" = l."docEntry"
      LEFT JOIN "Product" p ON p."itemCode" = l."itemCode"
      WHERE o."cancelled" = false AND o."docDate" >= ${from} AND o."docDate" < ${to} ${slpSql("o", slpName)}
      GROUP BY 1, 2
    )
    SELECT COALESCE(vol.iso_year, wt.iso_year) AS iso_year,
           COALESCE(vol.week,     wt.week)     AS week,
           COALESCE(vol.volume, 0) AS volume,
           COALESCE(wt.weight, 0)  AS weight
    FROM vol
    FULL OUTER JOIN wt ON vol.iso_year = wt.iso_year AND vol.week = wt.week
    ORDER BY 1, 2;
  `);
  return rows.map((r) => ({
    isoYear: Number(r.iso_year),
    week: Number(r.week),
    volume: Number(r.volume),
    weightKg: Number(r.weight),
  }));
}

/** Poids BL (kg) par client (cardCode) et par commercial (slpName) sur la fenêtre.
 *  Pour enrichir les tops de l'Écran 1 quand le mode « Volume » (kg) est actif. */
export async function orderWeightMaps(
  start: Date,
  end: Date,
  slpName?: string | null,
): Promise<{ byCard: Map<string, number>; bySlp: Map<string, number> }> {
  // 2 GROUP BY SQL au lieu de rapatrier toutes les lignes de la période en JS.
  const weightSelect = Prisma.sql`COALESCE(SUM(l."quantity" * COALESCE(p."salesUnitWeight", 0)), 0)::float AS w
    FROM "SapOrderLine" l
    JOIN "SapOrder" o ON o."docEntry" = l."docEntry"
    LEFT JOIN "Product" p ON p."itemCode" = l."itemCode"
    WHERE o."cancelled" = false AND o."docDate" >= ${start} AND o."docDate" < ${end} ${slpSql("o", slpName)}`;
  const [cardRows, slpRows] = await Promise.all([
    prisma.$queryRaw<{ k: string; w: number }[]>(Prisma.sql`
      SELECT o."cardCode" AS k, ${weightSelect}
      GROUP BY 1`),
    prisma.$queryRaw<{ k: string; w: number }[]>(Prisma.sql`
      SELECT o."slpName" AS k, ${weightSelect} AND o."slpName" IS NOT NULL
      GROUP BY 1`),
  ]);
  return {
    byCard: new Map(cardRows.map((r) => [r.k, Number(r.w)])),
    bySlp: new Map(slpRows.map((r) => [r.k, Number(r.w)])),
  };
}

/* ─────────────────────────────────────────────────────────────────
   Poids facturé (kg) — enrichissement des tops du rapport annuel.
   GROUP BY SQL restreint aux tops (≤ 8 cartes / 6 slp) : on ne charge
   plus toutes les lignes de l'année en JS.
   ───────────────────────────────────────────────────────────────── */

/** Poids facturé par client (Invoices × Product.salesUnitWeight) sur la fenêtre. */
export async function invoiceWeightByCard(start: Date, end: Date, cardCodes: string[], slpName?: string | null): Promise<Map<string, number>> {
  if (cardCodes.length === 0) return new Map();
  const rows = await prisma.$queryRaw<{ k: string; w: number }[]>(Prisma.sql`
    SELECT i."cardCode" AS k, COALESCE(SUM(l."quantity" * COALESCE(p."salesUnitWeight", 0)), 0)::float AS w
    FROM "SapInvoiceLine" l
    JOIN "SapInvoice" i ON i."docEntry" = l."docEntry"
    LEFT JOIN "Product" p ON p."itemCode" = l."itemCode"
    WHERE i."cancelled" = false AND i."docDate" >= ${start} AND i."docDate" < ${end}
      AND i."cardCode" IN (${Prisma.join(cardCodes)}) ${slpSql("i", slpName)}
    GROUP BY 1`);
  return new Map(rows.map((r) => [r.k, Number(r.w)]));
}

/** Poids reçu par fournisseur (PDN × Product.salesUnitWeight) sur la fenêtre. */
export async function pdnWeightByCard(start: Date, end: Date, cardCodes: string[]): Promise<Map<string, number>> {
  if (cardCodes.length === 0) return new Map();
  const rows = await prisma.$queryRaw<{ k: string; w: number }[]>(Prisma.sql`
    SELECT i."cardCode" AS k, COALESCE(SUM(l."quantity" * COALESCE(p."salesUnitWeight", 0)), 0)::float AS w
    FROM "SapPdnLine" l
    JOIN "SapPurchaseDeliveryNote" i ON i."docEntry" = l."docEntry"
    LEFT JOIN "Product" p ON p."itemCode" = l."itemCode"
    WHERE i."cancelled" = false AND i."docDate" >= ${start} AND i."docDate" < ${end}
      AND i."cardCode" IN (${Prisma.join(cardCodes)})
    GROUP BY 1`);
  return new Map(rows.map((r) => [r.k, Number(r.w)]));
}

/** Poids facturé par commercial (slpName), avec filtre segment optionnel. */
export async function invoiceWeightBySlp(
  start: Date, end: Date, slpNames: string[], groupCodes?: number[] | null,
): Promise<Map<string, number>> {
  if (slpNames.length === 0) return new Map();
  const rows = await prisma.$queryRaw<{ k: string; w: number }[]>(Prisma.sql`
    SELECT i."slpName" AS k, COALESCE(SUM(l."quantity" * COALESCE(p."salesUnitWeight", 0)), 0)::float AS w
    FROM "SapInvoiceLine" l
    JOIN "SapInvoice" i ON i."docEntry" = l."docEntry"
    LEFT JOIN "Product" p ON p."itemCode" = l."itemCode"
    WHERE i."cancelled" = false AND i."docDate" >= ${start} AND i."docDate" < ${end}
      AND i."slpName" IN (${Prisma.join(slpNames)}) ${segmentSql("i", groupCodes)}
    GROUP BY 1`);
  return new Map(rows.map((r) => [r.k, Number(r.w)]));
}

/* ─────────────────────────────────────────────────────────────────
   Drilldown mensuel — pour clic sur cellule de la matrice annuelle.
   Renvoie top clients + top items + distribution journalière du mois.
   ───────────────────────────────────────────────────────────────── */

export interface MonthDrilldown {
  year: number;
  month: number;                                 // 0-indexed (0=Jan)
  totalCa: number;
  totalMargin: number;
  totalWeightKg: number;
  invoicesCount: number;
  topClients: { cardCode: string; cardName: string | null; ca: number; weightKg: number; invoices: number }[];
  /** Top familles effectives (fraises fusionnées, fruits rouges par fruit — cf. lib/familles). */
  topFamilies: { key: string; label: string; quantity: number; ca: number; weightKg: number }[];
  daily: { day: number; ca: number; weightKg: number }[];   // jours 1..31 (filtré)
}

export async function monthDrilldown(year: number, month: number, groupCodes?: number[] | null, slpName?: string | null): Promise<MonthDrilldown> {
  const start = new Date(year, month, 1);
  const end = new Date(year, month + 1, 1);
  const seg = segmentWhere(groupCodes);
  const slpW = slpWhere(slpName);
  const segRaw = Prisma.sql`${segmentSql("i", groupCodes)} ${slpSql("i", slpName)}`;

  const [hdr, invMargin, invoices, lines] = await Promise.all([
    prisma.sapInvoice.aggregate({
      where: { docDate: { gte: start, lt: end }, cancelled: false, ...seg, ...slpW },
      _sum: { docTotal: true },
      _count: { docEntry: true },
    }),
    // Marge RÉELLE du mois (coût EM, lib/cogs) — plus jamais le grossProfit SAP.
    realMarginAgg(prisma, "invoice", start, end, segRaw),
    prisma.sapInvoice.findMany({
      where: { docDate: { gte: start, lt: end }, cancelled: false, ...seg, ...slpW },
      select: { docEntry: true, cardCode: true, cardName: true, docDate: true, docTotal: true },
    }),
    prisma.sapInvoiceLine.findMany({
      where: { invoice: { docDate: { gte: start, lt: end }, cancelled: false, ...seg, ...slpW } },
      select: { docEntry: true, itemCode: true, itemDescription: true, quantity: true, lineTotal: true },
    }),
  ]);

  // Catalogue restreint aux itemCode réellement présents dans les lignes du mois
  // (était un findMany sans where = ~tout le catalogue). Les maps weight/name/group
  // ne couvrent que les items utilisés — suffisant pour ce mois.
  const usedItemCodes = Array.from(
    new Set(lines.map((l) => l.itemCode).filter((c): c is string => c != null)),
  );
  const products = usedItemCodes.length > 0
    ? await prisma.product.findMany({
        where: { itemCode: { in: usedItemCodes } },
        select: { itemCode: true, itemName: true, groupName: true, salesUnitWeight: true },
      })
    : [];

  const weightByItem = new Map(products.map((p) => [p.itemCode, p.salesUnitWeight ?? 0]));
  const nameByItem = new Map(products.map((p) => [p.itemCode, p.itemName]));

  // ── Daily distribution
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const daily: { day: number; ca: number; weightKg: number }[] = [];
  for (let d = 1; d <= daysInMonth; d++) daily.push({ day: d, ca: 0, weightKg: 0 });
  for (const inv of invoices) {
    const day = new Date(inv.docDate).getDate();
    if (daily[day - 1]) daily[day - 1].ca += inv.docTotal;
  }
  // Weight by day requires joining lines to invoice docDate
  const invoiceDayMap = new Map(invoices.map((i) => [i.docEntry, new Date(i.docDate).getDate()]));
  for (const l of lines) {
    const day = invoiceDayMap.get(l.docEntry);
    if (day && daily[day - 1] && l.itemCode) {
      const w = (l.quantity ?? 0) * (weightByItem.get(l.itemCode) ?? 0);
      daily[day - 1].weightKg += w;
    }
  }

  // ── Top clients (par CA)
  const byClient = new Map<string, { cardName: string | null; ca: number; weightKg: number; invoices: Set<number> }>();
  for (const inv of invoices) {
    if (!byClient.has(inv.cardCode)) byClient.set(inv.cardCode, { cardName: inv.cardName, ca: 0, weightKg: 0, invoices: new Set() });
    const e = byClient.get(inv.cardCode)!;
    e.ca += inv.docTotal;
    e.invoices.add(inv.docEntry);
  }
  // Repartition du poids par client via les lines
  const docEntryToCardCode = new Map(invoices.map((i) => [i.docEntry, i.cardCode]));
  for (const l of lines) {
    const cc = docEntryToCardCode.get(l.docEntry);
    if (!cc) continue;
    const entry = byClient.get(cc);
    if (!entry || !l.itemCode) continue;
    entry.weightKg += (l.quantity ?? 0) * (weightByItem.get(l.itemCode) ?? 0);
  }
  const topClients = Array.from(byClient.entries())
    .map(([cardCode, e]) => ({ cardCode, cardName: e.cardName, ca: e.ca, weightKg: e.weightKg, invoices: e.invoices.size }))
    .sort((a, b) => b.ca - a.ca)
    .slice(0, 5);

  // ── Top FAMILLES (skip lignes service sans itemCode = location, prestation…)
  // Regroupement effectif : fraises fusionnées, fruits rouges éclatés par fruit,
  // le reste par groupe SAP — cf. lib/familles.familyOf (synchro avec la CTE).
  const groupNameByItem = new Map(products.map((p) => [p.itemCode, p.groupName ?? null]));
  const byFamily = new Map<string, { label: string; quantity: number; ca: number; weightKg: number }>();
  for (const l of lines) {
    if (!l.itemCode) continue;
    const fam = familyOf(nameByItem.get(l.itemCode) ?? l.itemDescription, groupNameByItem.get(l.itemCode));
    if (!byFamily.has(fam.key)) byFamily.set(fam.key, { label: fam.label, quantity: 0, ca: 0, weightKg: 0 });
    const e = byFamily.get(fam.key)!;
    e.quantity += l.quantity ?? 0;
    e.ca += l.lineTotal ?? 0;
    e.weightKg += (l.quantity ?? 0) * (weightByItem.get(l.itemCode) ?? 0);
  }
  const topFamilies = Array.from(byFamily.entries())
    .map(([key, e]) => ({ key, ...e }))
    .sort((a, b) => b.ca - a.ca)
    .slice(0, 6);

  return {
    year,
    month,
    totalCa: hdr._sum.docTotal ?? 0,
    totalMargin: invMargin.margin,
    totalWeightKg: daily.reduce((s, d) => s + d.weightKg, 0),
    invoicesCount: hdr._count.docEntry,
    topClients,
    topFamilies,
    daily,
  };
}

/* ─────────────────────────────────────────────────────────────────
   CRM télévente — # appels, # cdes CRM, taux conversion, clients touchés.
   Source : AppelLog (type COMMANDE | DEMAIN). YoY = même fenêtre 1 an avant.
   ───────────────────────────────────────────────────────────────── */

export interface CrmBucket {
  appels: number;
  cdesCrm: number;
  tauxConv: number;          // % cdes / appels
  clientsTouches: number;    // # clients distincts
}

export async function crmActivity(start: Date, end: Date, slpName?: string | null): Promise<CrmBucket> {
  const ids = await clientIdsForOwner(slpName);
  const rows = await prisma.appelLog.findMany({
    where: { heureAppel: { gte: start, lt: end }, ...(ids ? { clientId: { in: ids } } : {}) },
    select: { clientId: true, type: true },
  });
  const appels = rows.length;
  const cdesCrm = rows.filter((r) => r.type === "COMMANDE").length;
  const clientsTouches = new Set(rows.map((r) => r.clientId)).size;
  return {
    appels,
    cdesCrm,
    tauxConv: appels > 0 ? (cdesCrm / appels) * 100 : 0,
    clientsTouches,
  };
}

/* ─────────────────────────────────────────────────────────────────
   # appels CRM par client SAP — pour la tuile Top clients mixte
   (lookup par code SAP = Client.code).
   ───────────────────────────────────────────────────────────────── */

export async function crmCallsByCardCode(
  cardCodes: string[],
  start: Date,
  end: Date,
): Promise<Map<string, number>> {
  if (cardCodes.length === 0) return new Map();
  const rows = await prisma.appelLog.findMany({
    where: {
      heureAppel: { gte: start, lt: end },
      client: { code: { in: cardCodes } },
    },
    select: { client: { select: { code: true } } },
  });
  const m = new Map<string, number>();
  for (const r of rows) {
    if (!r.client?.code) continue;
    m.set(r.client.code, (m.get(r.client.code) ?? 0) + 1);
  }
  return m;
}

/* ─────────────────────────────────────────────────────────────────
   À relancer — clients planifiés sans commande SAP (Invoice) sur 30j.
   Renvoie nom, code, commercial, dernière activité connue.
   ───────────────────────────────────────────────────────────────── */

export interface ToRelance {
  clientId: string;
  code: string;
  nom: string;
  commercial: string | null;
  lastInvoiceDays: number | null;
}

export async function clientsToRelance(limit = 5, slpName?: string | null): Promise<ToRelance[]> {
  const last30 = new Date(); last30.setDate(last30.getDate() - 30);
  // Clients planifiés (scopés commercial OU vendeur pour un non-admin).
  const ids = await clientIdsForOwner(slpName);
  const planifies = await prisma.client.findMany({
    where: { joursAppel: { not: null }, ...(ids ? { id: { in: ids } } : {}) },
    select: { id: true, code: true, nom: true, commercial: true },
  });
  if (planifies.length === 0) return [];

  // Quels codes ont une facture SAP sur 30 j ?
  const recents = await prisma.sapInvoice.findMany({
    where: {
      docDate: { gte: last30 },
      cancelled: false,
      cardCode: { in: planifies.map((p) => p.code) },
    },
    select: { cardCode: true },
    distinct: ["cardCode"],
  });
  const recentSet = new Set(recents.map((r) => r.cardCode));

  const candidates = planifies.filter((p) => !recentSet.has(p.code));

  // Dernière facture par code (pour afficher "il y a X jours")
  const lastInvoices = candidates.length > 0
    ? await prisma.sapInvoice.findMany({
        where: { cardCode: { in: candidates.map((c) => c.code) }, cancelled: false },
        select: { cardCode: true, docDate: true },
        orderBy: { docDate: "desc" },
        distinct: ["cardCode"],
      })
    : [];
  const lastMap = new Map(lastInvoices.map((i) => [i.cardCode, i.docDate]));
  const today = Date.now();

  return candidates
    .map((c) => {
      const last = lastMap.get(c.code);
      const days = last ? Math.floor((today - last.getTime()) / 86_400_000) : null;
      return {
        clientId: c.id,
        code: c.code,
        nom: c.nom,
        commercial: c.commercial,
        lastInvoiceDays: days,
      };
    })
    .sort((a, b) => (b.lastInvoiceDays ?? 9999) - (a.lastInvoiceDays ?? 9999))
    .slice(0, limit);
}

export async function topSalespersons(start: Date, end: Date, limit = 10, groupCodes?: number[] | null): Promise<TopSalesperson[]> {
  const seg = segmentWhere(groupCodes);
  const grouped = await prisma.sapInvoice.groupBy({
    by: ["slpName"],
    where: { docDate: { gte: start, lt: end }, cancelled: false, slpName: { not: null }, ...seg },
    _sum: { docTotal: true },
    _count: { docEntry: true },
    orderBy: { _sum: { docTotal: "desc" } },
    take: limit,
  });

  const slpNames = grouped.flatMap((g) => (g.slpName ? [g.slpName] : []));

  // Marge réelle (coût EM) restreinte aux commerciaux du top — pas le gp SAP.
  const margins = await realMarginByKey("slpName", slpNames, start, end, groupCodes);

  // # clients actifs distincts par commercial — UNE seule requête (était N+1 :
  // un findMany distinct par commercial). COUNT(DISTINCT cardCode) GROUP BY slpName
  // sur les mêmes filtres (range + cancelled + segment), restreint au top N.
  const active = slpNames.length > 0
    ? await prisma.$queryRaw<{ k: string; n: number }[]>(Prisma.sql`
        SELECT i."slpName" AS k, COUNT(DISTINCT i."cardCode")::int AS n
        FROM "SapInvoice" i
        WHERE i."cancelled" = false AND i."docDate" >= ${start} AND i."docDate" < ${end}
          AND i."slpName" IN (${Prisma.join(slpNames)}) ${segmentSql("i", groupCodes)}
        GROUP BY 1`)
    : [];
  const activeMap = new Map(active.map((r) => [r.k, Number(r.n)]));

  const withActive: TopSalesperson[] = [];
  for (const g of grouped) {
    if (!g.slpName) continue;
    const md = margins.get(g.slpName);
    withActive.push({
      slpName: g.slpName,
      ca: g._sum.docTotal ?? 0,
      caProductNet: md?.caProductNet ?? 0,
      margin: md?.margin ?? 0,
      activeClients: activeMap.get(g.slpName) ?? 0,
      invoices: g._count.docEntry,
    });
  }
  return withActive;
}
