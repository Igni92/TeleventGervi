import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getAccessScope, resolvePilotageView, scopePayload } from "@/lib/permissions";
import { getActivity } from "@/lib/pilotageActivity";
import type { Granularity } from "@/lib/pilotage";

// Évite le timeout serverless sur les agrégations (cold start Vercel).
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * GET /api/pilotage/activity?g=day|week|month
 *
 * Cockpit Activité commerciale (BL) — Écran 1. Source = SapOrder.
 *
 * Renvoie volume BL, marge calculée ligne par ligne, # cdes, panier moyen,
 * clients actifs, + CRM (appels, cdes CRM, taux conv) sur la même fenêtre,
 * + top clients BL avec # appels CRM, + top commerciaux BL.
 *
 * Comparatif N-1 : même fenêtre 1 an avant (dynamique year-1).
 *
 * NB : la granularité "year" n'est PAS supportée ici — pour l'année on bascule
 * sur /api/pilotage/annual (rapport rétrospectif comptable).
 */
export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

  // Droits : non-admin (ou admin en « voir comme ») scopé sur le slpName ; le
  // classement des commerciaux (vue transverse) reste réservé à l'admin global.
  const url = new URL(req.url);
  const scope = await getAccessScope(session);
  const { slp, showTransverse } = resolvePilotageView(scope, url.searchParams.get("as"));

  const g = (url.searchParams.get("g") ?? "week") as Granularity;
  if (!["day", "week", "month"].includes(g)) {
    return NextResponse.json({ error: "Granularité invalide pour Activité (day|week|month)" }, { status: 400 });
  }

  const data = await getActivity(slp, showTransverse, g, {
    refresh: url.searchParams.get("refresh") === "1",
  });

  // `scope` recalculé HORS cache (flag admin propre à l'utilisateur).
  return NextResponse.json({ ...data, scope: scopePayload(scope) });
}
