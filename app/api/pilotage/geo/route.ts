import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getAccessScope, resolvePilotageView, scopePayload } from "@/lib/permissions";
import { geoAggregate } from "@/lib/pilotageGeo";
import { cached, invalidate } from "@/lib/ttlCache";

// Évite le timeout serverless sur les agrégations (cold start Vercel).
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * GET /api/pilotage/geo[?as=MM][&refresh=1]
 *
 * Distribution géographique du facturé (Écran 3 « Carte »), sur les 12 derniers
 * mois glissants. Périmètre : segments EXPORT + GMS + CHR uniquement (regroupés).
 *
 * Renvoie par ZONE (département FR ou pays export) : CA, marge réelle, poids (kg)
 * et nb de BL ; plus les totaux par segment (pour le camembert EXPORT/GMS/CHR).
 *
 * Scope commercial identique au reste du pilotage : un non-admin (ou un admin en
 * « voir comme ») ne voit que ses factures (slpName). Cache mémoire hebdomadaire
 * par périmètre ; ?refresh=1 force le recalcul.
 */

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

  const url = new URL(req.url);
  const scope = await getAccessScope(session);
  const { slp } = resolvePilotageView(scope, url.searchParams.get("as"));

  const cacheKey = `pilotage:geo:${slp ?? "ALL"}`;
  if (url.searchParams.get("refresh") === "1") invalidate(cacheKey);

  const payload = await cached(cacheKey, WEEK_MS, async () => {
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth() - 11, 1);
    const end = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    const geo = await geoAggregate(start, end, slp);
    return {
      period: { start: start.toISOString(), end: end.toISOString() },
      ...geo,
      scope: scopePayload(scope),
    };
  });

  return NextResponse.json(payload);
}
