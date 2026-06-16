import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getAccessScope, resolvePilotageView } from "@/lib/permissions";
import { weeklyInvoiceSeries } from "@/lib/pilotage";
import { isoWeek } from "@/lib/iso-week";
import { groupCodesForSegment, parseSegment } from "@/lib/segments";
import { cached, invalidate } from "@/lib/ttlCache";

/**
 * GET /api/pilotage/weekly
 *
 * Série hebdomadaire CA/marge NET (Invoices − Avoirs) par semaine ISO, de
 * l'année N-1 (1er janvier) jusqu'à aujourd'hui. Alimente :
 *   • le graphe d'évolution par n° de semaine (Écran 2 · vue Évolution),
 *   • l'onglet « semaines à événement » (lookup semaine N vs N-1).
 *
 * La UI aligne N et N-1 par numéro de semaine (saisonnalité fraises/fruits —
 * cf. dashboard-comparatif-yoy : on compare semaine S vs même semaine S-1an).
 */
export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

  // Droits : série CA/marge scopée au slpName (non-admin ou « voir comme »).
  const url = new URL(req.url);
  const scope = await getAccessScope(session);
  const { slp } = resolvePilotageView(scope, url.searchParams.get("as"));

  const segment = parseSegment(url.searchParams.get("segment"));

  const cacheKey = `pilotage:weekly:${slp ?? "ALL"}:${segment}`;
  if (url.searchParams.get("refresh") === "1") invalidate(cacheKey);

  const payload = await cached(cacheKey, 120_000, async () => {
    const now = new Date();
    const from = new Date(now.getFullYear() - 1, 0, 1); // 1er janv N-1
    const to = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1); // inclut aujourd'hui

    const weeks = await weeklyInvoiceSeries(from, to, groupCodesForSegment(segment), slp);
    const cur = isoWeek(now);

    return {
      currentYear: now.getFullYear(),
      currentIsoYear: cur.year,
      currentWeek: cur.week,
      weeks,
    };
  });

  return NextResponse.json(payload);
}
