import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import {
  periodBounds, previousYearBounds,
  topClients, topSuppliers, topSalespersons,
  crmCallsByCardCode,
  type Granularity,
} from "@/lib/pilotage";

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

  const url = new URL(req.url);
  const g = (url.searchParams.get("g") ?? "week") as Granularity;
  if (!["day", "week", "month", "year"].includes(g)) {
    return NextResponse.json({ error: "Granularité invalide" }, { status: 400 });
  }

  const curr = periodBounds(g);
  const prev = previousYearBounds(curr, g);

  const [clients, suppliers, salespersons, clientsPrev, salespersonsPrev] = await Promise.all([
    topClients(curr.start, curr.end, 8),
    topSuppliers(curr.start, curr.end, 6),
    topSalespersons(curr.start, curr.end, 8),
    topClients(prev.start, prev.end, 50),         // élargi pour matcher delta
    topSalespersons(prev.start, prev.end, 50),
  ]);

  const prevClientCa = new Map(clientsPrev.map((c) => [c.cardCode, c.ca]));
  const prevSlpCa = new Map(salespersonsPrev.map((s) => [s.slpName, s.ca]));

  // Enrichit chaque top client avec son # appels CRM sur la même fenêtre
  // (jointure clientsCode = SAP cardCode = Client.code TeleVent).
  const crmCalls = await crmCallsByCardCode(clients.map((c) => c.cardCode), curr.start, curr.end);

  return NextResponse.json({
    granularity: g,
    period: { start: curr.start, end: curr.end },
    clients: clients.map((c) => ({
      ...c,
      caPrev: prevClientCa.get(c.cardCode) ?? 0,
      crmCalls: crmCalls.get(c.cardCode) ?? 0,
    })),
    suppliers,
    salespersons: salespersons.map((s) => ({ ...s, caPrev: prevSlpCa.get(s.slpName) ?? 0 })),
  });
}
