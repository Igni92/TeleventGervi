import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getAccessScope, resolvePilotageView, scopePayload } from "@/lib/permissions";
import {
  aggregateActivity, periodBounds, previousYearBounds,
  topClientsOrder, topSalespersonsOrder, orderWeightMaps,
  crmActivity, crmCallsByCardCode,
  type Granularity,
} from "@/lib/pilotage";
import { cached, invalidate } from "@/lib/ttlCache";

// Évite le timeout serverless sur les agrégations (cold start Vercel).
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Cache court par périmètre+granularité ; le tick mirror purge "pilotage:" dès
// que de nouveaux docs arrivent, ce TTL n'est qu'un filet de sécurité.
const PILOTAGE_TTL_MS = 5 * 60_000;

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

  const cacheKey = `pilotage:activity:${slp ?? "ALL"}:${g}`;
  if (url.searchParams.get("refresh") === "1") invalidate(cacheKey);

  const data = await cached(cacheKey, PILOTAGE_TTL_MS, async () => {
    const curr = periodBounds(g);
    const prev = previousYearBounds(curr, g);

    const [currAct, prevAct, currCrm, prevCrm, tcs, sps, weightMaps] = await Promise.all([
      aggregateActivity(curr.start, curr.end, slp),
      aggregateActivity(prev.start, prev.end, slp),
      crmActivity(curr.start, curr.end, slp),
      crmActivity(prev.start, prev.end, slp),
      topClientsOrder(curr.start, curr.end, 6, slp),
      showTransverse ? topSalespersonsOrder(curr.start, curr.end, 6) : Promise.resolve([]),
      orderWeightMaps(curr.start, curr.end, slp),
    ]);

    // Fiabilité = part des lignes du jour effectivement COSTÉES (coût hybride).
    // Avec le coût SAP en dernier recours, c'est ~100 % : la marge n'est plus
    // faussée par un retard de synchro réception. (< 100 % signale de vraies
    // lignes sans aucun coût connu — pas une « vente à découvert ».)
    const reliability = currAct.caProductNet > 0 ? Math.round(currAct.marginCoverage) : null;

    // Enrichit top clients avec # appels CRM + poids BL (kg) sur la même fenêtre
    const crmCalls = await crmCallsByCardCode(tcs.map((t) => t.cardCode), curr.start, curr.end);
    const clients = tcs.map((c) => ({
      ...c,
      crmCalls: crmCalls.get(c.cardCode) ?? 0,
      weightKg: weightMaps.byCard.get(c.cardCode) ?? 0,
    }));
    const salespersons = sps.map((s) => ({ ...s, weightKg: weightMaps.bySlp.get(s.slpName) ?? 0 }));

    return {
      granularity: g,
      period: { start: curr.start, end: curr.end },
      previous: { start: prev.start, end: prev.end },
      curr: currAct,
      prev: prevAct,
      crm: currCrm,
      crmPrev: prevCrm,
      clients,
      salespersons,
      // Fiabilité = part des lignes du jour costées (coût hybride) ; ~100 % grâce
      // au repli coût SAP. < 100 % = vraies lignes sans coût connu.
      reliability,
    };
  });

  // `scope` recalculé HORS cache (flag admin propre à l'utilisateur).
  return NextResponse.json({ ...data, scope: scopePayload(scope) });
}
