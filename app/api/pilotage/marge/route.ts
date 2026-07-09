import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getAccessScope, resolvePilotageView } from "@/lib/permissions";
import { aggregateActivity } from "@/lib/pilotage";
import { cached, invalidate } from "@/lib/ttlCache";

// Agrégation lourde → hors budget serverless court.
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const TTL_MS = 5 * 60_000;
const WINDOW_DAYS = 30;

/**
 * GET /api/pilotage/marge
 *
 * TAUX DE MARGE BRUT (%) — estimation « la plus juste possible » sur une fenêtre
 * glissante de 30 jours. Source : SapOrder (BL) + coût RÉEL d'entrée marchandise
 * (lib/cogs — jamais la marge SAP). Chaque vente est costée au prix de la
 * dernière réception de l'article ; les lignes sans coût connu (vente à découvert
 * avant réception, article jamais reçu) NE faussent PAS le taux — elles sont
 * exclues du numérateur/dénominateur et comptées dans la COUVERTURE.
 *
 * → plus les réceptions rentrent et plus le stock est « propre », plus la
 *   couverture monte et plus le taux est fiable (il s'affine avec le temps).
 *
 * Réponse : { days, marginPct, coverage, caProductNet, margin }
 *   • marginPct  = marge brute / CA produit net × 100 ;
 *   • coverage   = % du CA produit dont le coût d'entrée est résolu (fiabilité).
 */
export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

  const url = new URL(req.url);
  const scope = await getAccessScope(session);
  const { slp } = resolvePilotageView(scope, url.searchParams.get("as"));

  const cacheKey = `pilotage:marge:${slp ?? "ALL"}:${WINDOW_DAYS}`;
  if (url.searchParams.get("refresh") === "1") invalidate(cacheKey);

  const data = await cached(cacheKey, TTL_MS, async () => {
    const end = new Date();
    const start = new Date(end.getTime() - WINDOW_DAYS * 86_400_000);
    const agg = await aggregateActivity(start, end, slp);
    return {
      days: WINDOW_DAYS,
      marginPct: agg.marginPct,
      coverage: agg.marginCoverage,
      caProductNet: agg.caProductNet,
      margin: agg.margin,
    };
  });

  return NextResponse.json(data);
}
