import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getAccessScope, resolvePilotageView, scopePayload } from "@/lib/permissions";
import {
  periodBounds, previousYearBounds,
  topClients, topSuppliers, topSalespersons,
  crmCallsByCardCode,
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
 * GET /api/pilotage/tops?g=day|week|month|year
 *
 * Top 10 clients (CA + marge), top 10 fournisseurs (valeur PDN),
 * top 10 commerciaux (CA + marge + # clients actifs).
 *
 * Renvoie aussi les chiffres N-1 (même période 1 an avant) côté tops clients/commerciaux
 * pour affichage delta dans le bento.
 */
export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

  // Droits : top clients scopé sur le slpName (non-admin ou admin « voir comme ») ;
  // top fournisseurs (achats) et top commerciaux (transverses) réservés à l'admin global.
  const url = new URL(req.url);
  const scope = await getAccessScope(session);
  const { slp, showTransverse } = resolvePilotageView(scope, url.searchParams.get("as"));

  const g = (url.searchParams.get("g") ?? "week") as Granularity;
  if (!["day", "week", "month", "year"].includes(g)) {
    return NextResponse.json({ error: "Granularité invalide" }, { status: 400 });
  }

  const cacheKey = `pilotage:tops:${slp ?? "ALL"}:${g}`;
  if (url.searchParams.get("refresh") === "1") invalidate(cacheKey);

  const data = await cached(cacheKey, PILOTAGE_TTL_MS, async () => {
    const curr = periodBounds(g);
    const prev = previousYearBounds(curr, g);

    const [clients, suppliers, salespersons, clientsPrev, salespersonsPrev] = await Promise.all([
      topClients(curr.start, curr.end, 8, null, slp),
      showTransverse ? topSuppliers(curr.start, curr.end, 6) : Promise.resolve([]),
      showTransverse ? topSalespersons(curr.start, curr.end, 8) : Promise.resolve([]),
      topClients(prev.start, prev.end, 50, null, slp),   // élargi pour matcher delta
      showTransverse ? topSalespersons(prev.start, prev.end, 50) : Promise.resolve([]),
    ]);

    const prevClientCa = new Map(clientsPrev.map((c) => [c.cardCode, c.ca]));
    const prevSlpCa = new Map(salespersonsPrev.map((s) => [s.slpName, s.ca]));

    // Enrichit chaque top client avec son # appels CRM sur la même fenêtre
    // (jointure clientsCode = SAP cardCode = Client.code TeleVent).
    const crmCalls = await crmCallsByCardCode(clients.map((c) => c.cardCode), curr.start, curr.end);

    return {
      granularity: g,
      period: { start: curr.start, end: curr.end },
      clients: clients.map((c) => ({
        ...c,
        caPrev: prevClientCa.get(c.cardCode) ?? 0,
        crmCalls: crmCalls.get(c.cardCode) ?? 0,
      })),
      suppliers,
      salespersons: salespersons.map((s) => ({ ...s, caPrev: prevSlpCa.get(s.slpName) ?? 0 })),
    };
  });

  // `scope` recalculé HORS cache (admin vs commercial même slp → même data,
  // mais flag admin différent) pour ne pas servir le mauvais périmètre.
  return NextResponse.json({ ...data, scope: scopePayload(scope) });
}
