import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { monthDrilldown } from "@/lib/pilotage";
import { groupCodesForSegment, parseSegment } from "@/lib/segments";

/**
 * GET /api/pilotage/annual/month?year=YYYY&month=0..11
 *
 * Drilldown mensuel pour clic sur cellule de la matrice annuelle (Écran 2).
 * Renvoie top 5 clients, top familles (regroupées), distribution journalière.
 */
export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

  const url = new URL(req.url);
  const year = Number.parseInt(url.searchParams.get("year") ?? "");
  const month = Number.parseInt(url.searchParams.get("month") ?? "");
  if (!Number.isFinite(year) || !Number.isFinite(month) || month < 0 || month > 11) {
    return NextResponse.json({ error: "Paramètres invalides (year, month 0..11)" }, { status: 400 });
  }

  const segment = parseSegment(url.searchParams.get("segment"));

  const data = await monthDrilldown(year, month, groupCodesForSegment(segment));
  return NextResponse.json(data);
}
