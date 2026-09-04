import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { requireAdmin } from "@/lib/permissions";
import { isRhV2Enabled } from "@/lib/rh/flag";
import { gatherAnnual } from "@/lib/rh/annualAggregate";

export const dynamic = "force-dynamic";

/** GET /api/rh/annualisation?year=YYYY — tableau d'annualisation 1600 h. Direction. */
export async function GET(req: NextRequest) {
  if (!isRhV2Enabled()) return NextResponse.json({ error: "Module RH V2 désactivé" }, { status: 404 });
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  if (!(await requireAdmin(session))) return NextResponse.json({ error: "Réservé à la direction" }, { status: 403 });

  const raw = Number(new URL(req.url).searchParams.get("year"));
  const year = Number.isInteger(raw) && raw >= 2000 && raw <= 2100 ? raw : new Date().getUTCFullYear();
  const board = await gatherAnnual(year);
  return NextResponse.json({ ok: true, ...board });
}
