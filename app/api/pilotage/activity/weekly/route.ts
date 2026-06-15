import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getAccessScope, pilotageSlpFilter } from "@/lib/permissions";
import { weeklyOrderSeries } from "@/lib/pilotage";
import { isoWeek } from "@/lib/iso-week";

/**
 * GET /api/pilotage/activity/weekly
 *
 * Série hebdomadaire du volume BL (Orders) par semaine ISO, de l'année N-1
 * (1er janvier) à aujourd'hui. Alimente les courbes/sparklines de l'Écran 1
 * commercial (≠ /api/pilotage/weekly qui est le CA facturé comptable).
 */
export async function GET() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

  // Droits : série volume BL scopée au slpName du non-admin.
  const scope = await getAccessScope(session);
  const slp = pilotageSlpFilter(scope);

  const now = new Date();
  const from = new Date(now.getFullYear() - 1, 0, 1);
  const to = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);

  const weeks = await weeklyOrderSeries(from, to, slp);
  const cur = isoWeek(now);

  return NextResponse.json({
    currentIsoYear: cur.year,
    currentWeek: cur.week,
    weeks,
  });
}
