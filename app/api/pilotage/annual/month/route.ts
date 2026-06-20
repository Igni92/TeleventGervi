import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getAccessScope, resolvePilotageView } from "@/lib/permissions";
import { monthDrilldown } from "@/lib/pilotage";
import { groupCodesForSegment, parseSegment } from "@/lib/segments";
import { cached, invalidate } from "@/lib/ttlCache";

// Évite le timeout serverless sur les agrégations (cold start Vercel).
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const PILOTAGE_TTL_MS = 5 * 60_000; // filet de sécurité (le tick mirror purge "pilotage:")

/**
 * GET /api/pilotage/annual/month?year=YYYY&month=0..11
 *
 * Drilldown mensuel pour clic sur cellule de la matrice annuelle (Écran 2).
 * Renvoie top 5 clients, top familles (regroupées), distribution journalière.
 */
export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

  // Droits : drilldown mensuel scopé au slpName (non-admin ou « voir comme »).
  const url = new URL(req.url);
  const scope = await getAccessScope(session);
  const { slp } = resolvePilotageView(scope, url.searchParams.get("as"));

  const year = Number.parseInt(url.searchParams.get("year") ?? "");
  const month = Number.parseInt(url.searchParams.get("month") ?? "");
  if (!Number.isFinite(year) || !Number.isFinite(month) || month < 0 || month > 11) {
    return NextResponse.json({ error: "Paramètres invalides (year, month 0..11)" }, { status: 400 });
  }

  const segment = parseSegment(url.searchParams.get("segment"));

  const cacheKey = `pilotage:annual-month:${slp ?? "ALL"}:${year}:${month}:${segment}`;
  if (url.searchParams.get("refresh") === "1") invalidate(cacheKey);
  const data = await cached(cacheKey, PILOTAGE_TTL_MS, () =>
    monthDrilldown(year, month, groupCodesForSegment(segment), slp),
  );
  return NextResponse.json(data);
}
