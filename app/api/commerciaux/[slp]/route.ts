import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getAccessScope, scopePayload, UNMAPPED_MESSAGE } from "@/lib/permissions";
import { isoWeek, isoWeekStart, isoWeekLabel } from "@/lib/iso-week";
import { realMarginAgg } from "@/lib/cogs";

/**
 * GET /api/commerciaux/[slp]?range=week|month|year — fiche commercial SAP.
 *
 * Deux états, deux sources (cf. quirks Service Layer / miroir local) :
 *   - « État commercial » : SapOrder (BL / commandes) — volume HT, nb cdes,
 *     clients actifs, panier moyen, volume kg, évolution hebdo N vs N-1.
 *   - « État comptable »  : SapInvoice − SapCreditNote — CA net, marge RÉELLE
 *     (coût d'entrée marchandise, lib/cogs — plus jamais le grossProfit SAP), nb factures.
 *
 * Comparatif N-1 : même fenêtre décalée d'un an (semaine ISO homologue pour
 * range=week — saisonnalité fraises oblige, jamais de WoW).
 *
 * Droits : un non-admin ne peut consulter QUE sa propre fiche → 403 sinon.
 */
export const dynamic = "force-dynamic";

type Range = "week" | "month" | "year";

function periodBounds(range: Range, now: Date): { from: Date; to: Date; prevFrom: Date; prevTo: Date } {
  const to = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1); // exclusif (fin de journée)
  let from: Date;
  let prevFrom: Date;
  if (range === "week") {
    const w = isoWeek(now);
    from = isoWeekStart(w.year, w.week);
    prevFrom = isoWeekStart(w.year - 1, w.week); // semaine ISO homologue N-1
  } else if (range === "month") {
    from = new Date(now.getFullYear(), now.getMonth(), 1);
    prevFrom = new Date(now.getFullYear() - 1, now.getMonth(), 1);
  } else {
    from = new Date(now.getFullYear(), 0, 1);
    prevFrom = new Date(now.getFullYear() - 1, 0, 1);
  }
  // Fenêtre N-1 = même durée écoulée (comparaison à périmètre égal).
  const prevTo = new Date(prevFrom.getTime() + (to.getTime() - from.getTime()));
  return { from, to, prevFrom, prevTo };
}

/** Agrégat « état commercial » (SapOrder) sur une fenêtre. */
async function orderKpis(slp: string, from: Date, to: Date) {
  const [[hdr], [wt]] = await Promise.all([
    prisma.$queryRaw<{ ht: number; nb: number; clients: number }[]>(Prisma.sql`
      SELECT COALESCE(SUM("docTotal"), 0)::float AS ht, COUNT(*)::int AS nb,
             COUNT(DISTINCT "cardCode")::int AS clients
      FROM "SapOrder"
      WHERE "cancelled" = false AND "slpName" = ${slp}
        AND "docDate" >= ${from} AND "docDate" < ${to}`),
    prisma.$queryRaw<{ kg: number }[]>(Prisma.sql`
      SELECT COALESCE(SUM(l."quantity" * COALESCE(p."salesUnitWeight", 0)), 0)::float AS kg
      FROM "SapOrderLine" l
      JOIN "SapOrder" o ON o."docEntry" = l."docEntry"
      LEFT JOIN "Product" p ON p."itemCode" = l."itemCode"
      WHERE o."cancelled" = false AND o."slpName" = ${slp}
        AND o."docDate" >= ${from} AND o."docDate" < ${to}`),
  ]);
  const ht = Number(hdr?.ht ?? 0);
  const nb = Number(hdr?.nb ?? 0);
  return {
    ht, nb,
    clients: Number(hdr?.clients ?? 0),
    panier: nb > 0 ? ht / nb : 0,
    kg: Number(wt?.kg ?? 0),
  };
}

/** Agrégat « état comptable » (SapInvoice − SapCreditNote) sur une fenêtre.
 *  Marge = coût d'entrée marchandise réel (lib/cogs), Invoices − Avoirs ;
 *  filtre commercial via l'alias `i` attendu par realMarginAgg/cogsFromSql. */
async function invoiceKpis(slp: string, from: Date, to: Date) {
  const slpFilter = Prisma.sql`AND i."slpName" = ${slp}`;
  const [[inv], [cn], invMargin, cnMargin] = await Promise.all([
    prisma.$queryRaw<{ ca: number; nb: number }[]>(Prisma.sql`
      SELECT COALESCE(SUM("docTotal"), 0)::float AS ca, COUNT(*)::int AS nb
      FROM "SapInvoice"
      WHERE "cancelled" = false AND "slpName" = ${slp}
        AND "docDate" >= ${from} AND "docDate" < ${to}`),
    prisma.$queryRaw<{ ca: number; nb: number }[]>(Prisma.sql`
      SELECT COALESCE(SUM("docTotal"), 0)::float AS ca, COUNT(*)::int AS nb
      FROM "SapCreditNote"
      WHERE "cancelled" = false AND "slpName" = ${slp}
        AND "docDate" >= ${from} AND "docDate" < ${to}`),
    realMarginAgg(prisma, "invoice", from, to, slpFilter),
    realMarginAgg(prisma, "creditNote", from, to, slpFilter),
  ]);
  return {
    caNet: Number(inv?.ca ?? 0) - Number(cn?.ca ?? 0),
    marge: invMargin.margin - cnMargin.margin,
    nbFactures: Number(inv?.nb ?? 0),
    nbAvoirs: Number(cn?.nb ?? 0),
  };
}

export async function GET(req: NextRequest, { params }: { params: { slp: string } }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

  const slp = decodeURIComponent(params.slp).trim();
  if (!slp) return NextResponse.json({ error: "Commercial manquant" }, { status: 400 });

  const scope = await getAccessScope(session);
  if (!scope.all) {
    if (!scope.slpName) {
      return NextResponse.json({ error: UNMAPPED_MESSAGE, restricted: true }, { status: 403 });
    }
    if (scope.slpName !== slp) {
      return NextResponse.json(
        { error: "Accès limité à votre propre fiche commercial.", restricted: true },
        { status: 403 },
      );
    }
  }

  const rangeParam = req.nextUrl.searchParams.get("range");
  const range: Range = rangeParam === "week" || rangeParam === "year" ? rangeParam : "month";

  const now = new Date();
  const { from, to, prevFrom, prevTo } = periodBounds(range, now);

  // ── Évolution hebdo N vs N-1 (volume HT BL, 12 dernières semaines ISO) ──
  const histStart = new Date(now.getTime() - 430 * 86_400_000); // couvre N et N-1
  const weeklyPromise = prisma.$queryRaw<{ y: number; w: number; v: number }[]>(Prisma.sql`
    SELECT EXTRACT(ISOYEAR FROM "docDate")::int AS y,
           EXTRACT(WEEK    FROM "docDate")::int AS w,
           COALESCE(SUM("docTotal"), 0)::float AS v
    FROM "SapOrder"
    WHERE "cancelled" = false AND "slpName" = ${slp} AND "docDate" >= ${histStart}
    GROUP BY 1, 2`);

  // ── Top clients (factures de la période) + activité récente (BL) ──
  const topPromise = prisma.$queryRaw<{ cardCode: string; cardName: string | null; ca: number; nb: number }[]>(Prisma.sql`
    SELECT "cardCode", MAX("cardName") AS "cardName",
           COALESCE(SUM("docTotal"), 0)::float AS ca, COUNT(*)::int AS nb
    FROM "SapInvoice"
    WHERE "cancelled" = false AND "slpName" = ${slp}
      AND "docDate" >= ${from} AND "docDate" < ${to}
    GROUP BY 1 ORDER BY ca DESC LIMIT 10`);
  const recentPromise = prisma.$queryRaw<{ docNum: number | null; docDate: Date; cardCode: string; cardName: string | null; docTotal: number }[]>(Prisma.sql`
    SELECT "docNum", "docDate", "cardCode", "cardName", "docTotal"::float AS "docTotal"
    FROM "SapOrder"
    WHERE "cancelled" = false AND "slpName" = ${slp}
    ORDER BY "docDate" DESC, "docEntry" DESC LIMIT 15`);

  const [curr, prev, compta, comptaPrev, weeklyRows, topClients, recentOrders] = await Promise.all([
    orderKpis(slp, from, to),
    orderKpis(slp, prevFrom, prevTo),
    invoiceKpis(slp, from, to),
    invoiceKpis(slp, prevFrom, prevTo),
    weeklyPromise,
    topPromise,
    recentPromise,
  ]);

  // Poids kg des tops, filtré sur CE commercial (≠ invoiceWeightByCard global).
  const topCodes = topClients.map((t) => t.cardCode);
  const kgRows = topCodes.length
    ? await prisma.$queryRaw<{ k: string; kg: number }[]>(Prisma.sql`
        SELECT i."cardCode" AS k, COALESCE(SUM(l."quantity" * COALESCE(p."salesUnitWeight", 0)), 0)::float AS kg
        FROM "SapInvoiceLine" l
        JOIN "SapInvoice" i ON i."docEntry" = l."docEntry"
        LEFT JOIN "Product" p ON p."itemCode" = l."itemCode"
        WHERE i."cancelled" = false AND i."slpName" = ${slp}
          AND i."docDate" >= ${from} AND i."docDate" < ${to}
          AND i."cardCode" IN (${Prisma.join(topCodes)})
        GROUP BY 1`)
    : [];
  const kgMap = new Map(kgRows.map((r) => [r.k, Number(r.kg)]));

  // Assemblage série hebdo : 12 dernières semaines, compare = semaine homologue N-1.
  const weekMap = new Map(weeklyRows.map((r) => [`${r.y}-${r.w}`, Number(r.v)]));
  const weekly: { label: string; value: number; compare: number }[] = [];
  for (let i = 11; i >= 0; i--) {
    const wk = isoWeek(new Date(now.getTime() - i * 7 * 86_400_000));
    weekly.push({
      label: isoWeekLabel(wk.week),
      value: weekMap.get(`${wk.year}-${wk.week}`) ?? 0,
      compare: weekMap.get(`${wk.year - 1}-${wk.week}`) ?? 0,
    });
  }

  return NextResponse.json({
    ok: true,
    slp,
    range,
    period: {
      from: from.toISOString().slice(0, 10),
      to: to.toISOString().slice(0, 10),
      prevFrom: prevFrom.toISOString().slice(0, 10),
      prevTo: prevTo.toISOString().slice(0, 10),
    },
    commercial: { ...curr, prev },
    comptable: { ...compta, prev: comptaPrev },
    weekly,
    topClients: topClients.map((t) => ({
      cardCode: t.cardCode,
      cardName: t.cardName,
      ca: Number(t.ca),
      nb: Number(t.nb),
      kg: kgMap.get(t.cardCode) ?? 0,
    })),
    recentOrders: recentOrders.map((o) => ({
      docNum: o.docNum,
      docDate: o.docDate,
      cardCode: o.cardCode,
      cardName: o.cardName,
      docTotal: Number(o.docTotal),
    })),
    scope: scopePayload(scope),
  });
}
