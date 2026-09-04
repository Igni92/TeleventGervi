import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { requireAdmin } from "@/lib/permissions";
import { isRhV2Enabled } from "@/lib/rh/flag";
import { gatherTeamWeek, currentIsoWeek } from "@/lib/rh/week";

export const dynamic = "force-dynamic";

/** GET /api/rh/week?week=YYYY-Www — feuille d'équipe de la semaine (socle neuf).
 *  Alimente les écrans Heures & pointages et Planning. Direction. */
export async function GET(req: NextRequest) {
  if (!isRhV2Enabled()) return NextResponse.json({ error: "Module RH V2 désactivé" }, { status: 404 });
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  if (!(await requireAdmin(session))) return NextResponse.json({ error: "Réservé à la direction" }, { status: 403 });

  const raw = new URL(req.url).searchParams.get("week");
  const iso = raw && /^\d{4}-W\d{2}$/.test(raw) ? raw : currentIsoWeek();
  const week = await gatherTeamWeek(iso);
  return NextResponse.json({ ok: true, ...week });
}
