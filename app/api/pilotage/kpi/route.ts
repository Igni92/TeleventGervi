import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getAccessScope, resolvePilotageView, scopePayload } from "@/lib/permissions";
import {
  aggregateKpi, periodBounds, previousYearBounds,
  caLast12Months, caLast12MonthsPrevYear,
  crmActivity,
  type Granularity,
} from "@/lib/pilotage";

/**
 * GET /api/pilotage/kpi?g=day|week|month|year
 *
 * Retourne {curr, prev (YoY), spark12m, heatmap} pour le tableau de pilotage.
 * Source : SapInvoice (vue comptable, cf. choix métier).
 */
export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

  // Droits : un non-admin ne voit QUE ses propres chiffres ; un admin peut
  // imiter un commercial via ?as=MM (« voir comme »).
  const url = new URL(req.url);
  const scope = await getAccessScope(session);
  const { slp } = resolvePilotageView(scope, url.searchParams.get("as"));

  const g = (url.searchParams.get("g") ?? "week") as Granularity;
  if (!["day", "week", "month", "year"].includes(g)) {
    return NextResponse.json({ error: "Granularité invalide" }, { status: 400 });
  }

  const curr = periodBounds(g);
  const prev = previousYearBounds(curr, g);

  const [currKpi, prevKpi, spark, sparkPrev, currCrm, prevCrm] = await Promise.all([
    aggregateKpi(curr.start, curr.end, slp),
    aggregateKpi(prev.start, prev.end, slp),
    caLast12Months(new Date(), slp),
    caLast12MonthsPrevYear(new Date(), slp),
    crmActivity(curr.start, curr.end, slp),
    crmActivity(prev.start, prev.end, slp),
  ]);

  return NextResponse.json({
    granularity: g,
    period: { start: curr.start, end: curr.end },
    previous: { start: prev.start, end: prev.end },
    curr: currKpi,
    prev: prevKpi,
    crm: currCrm,
    crmPrev: prevCrm,
    spark12m: spark,
    spark12mPrev: sparkPrev,
    scope: scopePayload(scope),
  });
}
