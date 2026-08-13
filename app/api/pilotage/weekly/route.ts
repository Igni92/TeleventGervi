import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getAccessScope, resolvePilotageView } from "@/lib/permissions";
import { weeklyInvoiceSeries } from "@/lib/pilotage";
import { isoWeek } from "@/lib/iso-week";
import { parisCivilParts } from "@/lib/pilotage-time";
import { parisEndOfDay, parisStartOfDay } from "@/lib/paris-time";
import { groupCodesForSegment, parseSegment } from "@/lib/segments";
import { cached, invalidate } from "@/lib/ttlCache";

// Évite le timeout serverless sur les agrégations (cold start Vercel).
export const dynamic = "force-dynamic";
export const maxDuration = 60;

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
    // Audit 2026-08-13 (#21) : année/semaine courantes dérivées en Europe/Paris —
    // `now.getFullYear()` et `isoWeek(now)` lisaient l'UTC du serveur, donc entre
    // minuit et 02h heure de Paris le 1er janvier la fenêtre et le marqueur de
    // semaine courante basculaient un an trop tard.
    const { year, month, day } = parisCivilParts(now);
    const from = parisStartOfDay(new Date(Date.UTC(year - 1, 0, 1))); // 1er janv N-1 (Paris)
    const to = parisEndOfDay(now); // inclut aujourd'hui (borne haute = minuit Paris demain)

    const weeks = await weeklyInvoiceSeries(from, to, groupCodesForSegment(segment), slp);
    // isoWeek lit les getters LOCAUX : on lui passe la date CIVILE de Paris (midi
    // UTC pour éviter tout effet de bord) → n° de semaine ISO en heure française.
    const cur = isoWeek(new Date(Date.UTC(year, month - 1, day, 12)));

    return {
      currentYear: year,
      currentIsoYear: cur.year,
      currentWeek: cur.week,
      weeks,
    };
  });

  return NextResponse.json(payload);
}
