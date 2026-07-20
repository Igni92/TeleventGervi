import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getAccessScope, resolvePilotageView, scopePayload } from "@/lib/permissions";
import { topSuppliers, pdnWeightByCard } from "@/lib/pilotage";
import { cached, invalidate } from "@/lib/ttlCache";

// Évite le timeout serverless sur les agrégations (cold start Vercel).
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * GET /api/pilotage/suppliers[?refresh=1]
 *
 * DÉTAIL FOURNISSEURS (modale plein écran du pilotage unifié) — top 40 sur les
 * 12 derniers mois glissants : achats NETS HT (EM − retours), nb d'EM, poids.
 *
 * Transverse (achats) → réservé à l'admin/direction, comme le top fournisseurs
 * du rapport annuel. Cache mémoire 1 h ; ?refresh=1 force le recalcul.
 */
const HOUR_MS = 60 * 60 * 1000;

export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

  const url = new URL(req.url);
  const scope = await getAccessScope(session);
  const { showTransverse } = resolvePilotageView(scope, url.searchParams.get("as"));
  if (!showTransverse) {
    return NextResponse.json({ suppliers: [], restricted: true, scope: scopePayload(scope) });
  }

  const cacheKey = "pilotage:suppliers:12m";
  if (url.searchParams.get("refresh") === "1") invalidate(cacheKey);

  const payload = await cached(cacheKey, HOUR_MS, async () => {
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth() - 11, 1);
    const end = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    const suppliers = await topSuppliers(start, end, 40);
    const weights = await pdnWeightByCard(start, end, suppliers.map((s) => s.cardCode));
    return {
      period: { start: start.toISOString(), end: end.toISOString() },
      suppliers: suppliers.map((s) => ({ ...s, weightKg: weights.get(s.cardCode) ?? 0 })),
    };
  });

  return NextResponse.json({ ...payload, scope: scopePayload(scope) });
}
