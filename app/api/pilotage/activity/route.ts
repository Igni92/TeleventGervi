import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import {
  aggregateActivity, periodBounds, previousYearBounds,
  topClientsOrder, topSalespersonsOrder, orderWeightMaps,
  crmActivity, crmCallsByCardCode,
  type Granularity,
} from "@/lib/pilotage";

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

  const url = new URL(req.url);
  const g = (url.searchParams.get("g") ?? "week") as Granularity;
  if (!["day", "week", "month"].includes(g)) {
    return NextResponse.json({ error: "Granularité invalide pour Activité (day|week|month)" }, { status: 400 });
  }

  const curr = periodBounds(g);
  const prev = previousYearBounds(curr, g);

  const [currAct, prevAct, currCrm, prevCrm, tcs, sps, weightMaps] = await Promise.all([
    aggregateActivity(curr.start, curr.end),
    aggregateActivity(prev.start, prev.end),
    crmActivity(curr.start, curr.end),
    crmActivity(prev.start, prev.end),
    topClientsOrder(curr.start, curr.end, 6),
    topSalespersonsOrder(curr.start, curr.end, 6),
    orderWeightMaps(curr.start, curr.end),
  ]);

  // Enrichit top clients avec # appels CRM + poids BL (kg) sur la même fenêtre
  const crmCalls = await crmCallsByCardCode(tcs.map((t) => t.cardCode), curr.start, curr.end);
  const clients = tcs.map((c) => ({
    ...c,
    crmCalls: crmCalls.get(c.cardCode) ?? 0,
    weightKg: weightMaps.byCard.get(c.cardCode) ?? 0,
  }));
  const salespersons = sps.map((s) => ({ ...s, weightKg: weightMaps.bySlp.get(s.slpName) ?? 0 }));

  return NextResponse.json({
    granularity: g,
    period: { start: curr.start, end: curr.end },
    previous: { start: prev.start, end: prev.end },
    curr: currAct,
    prev: prevAct,
    crm: currCrm,
    crmPrev: prevCrm,
    clients,
    salespersons,
  });
}
