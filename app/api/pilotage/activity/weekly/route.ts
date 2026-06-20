import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getAccessScope, resolvePilotageView } from "@/lib/permissions";
import { weeklyOrderSeries } from "@/lib/pilotage";
import { isoWeek } from "@/lib/iso-week";
import { cached, invalidate } from "@/lib/ttlCache";

// Évite le timeout serverless sur les agrégations (cold start Vercel).
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const PILOTAGE_TTL_MS = 5 * 60_000; // filet de sécurité (le tick mirror purge "pilotage:")

/**
 * GET /api/pilotage/activity/weekly
 *
 * Série hebdomadaire du volume BL (Orders) par semaine ISO, de l'année N-1
 * (1er janvier) à aujourd'hui. Alimente les courbes/sparklines de l'Écran 1
 * commercial (≠ /api/pilotage/weekly qui est le CA facturé comptable).
 */
export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

  // Droits : série volume BL scopée au slpName (non-admin ou « voir comme »).
  const scope = await getAccessScope(session);
  const { slp } = resolvePilotageView(scope, new URL(req.url).searchParams.get("as"));

  const cacheKey = `pilotage:activity-weekly:${slp ?? "ALL"}`;
  if (new URL(req.url).searchParams.get("refresh") === "1") invalidate(cacheKey);

  const payload = await cached(cacheKey, PILOTAGE_TTL_MS, async () => {
    const now = new Date();
    const from = new Date(now.getFullYear() - 1, 0, 1);
    const to = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);

    const weeks = await weeklyOrderSeries(from, to, slp);
    const cur = isoWeek(now);
    return { currentIsoYear: cur.year, currentWeek: cur.week, weeks };
  });

  return NextResponse.json(payload);
}
