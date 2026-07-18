import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { requireAdmin } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { sap } from "@/lib/sapb1";
import { getTransportModel, listCarrierTariffs } from "@/lib/transportCostStore";
import {
  computeTransportMetrics,
  transportPerKgForCarrier,
  isDirectCarrier,
  normCarrier,
  sanitizeClientPricing,
  type ClientCarrierPricing,
} from "@/lib/transportCost";
import { computePositionCost } from "@/lib/carrierTariff";
import { departementOfZip } from "@/lib/geo/zip";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * ÉTATS DÉTAILLÉS des coûts de livraison (12 mois glissants), calculés depuis
 * les BL SAP et ventilés :
 *   • par POSTE de coût (amortissement, salaire, carburant…) — depuis le modèle ;
 *   • par TRANSPORTEUR (U_TrspCode) — livraisons, kg, coût transport appliqué ;
 *   • par CLIENT — idem + part direct / externe.
 *
 * Le coût appliqué suit la règle : transporteur direct → prix position ;
 * transporteur externe → GRILLE par position du transporteur (tranche de poids
 * × département du client + lignes fixes/%, cf. lib/carrierTariff), repli sur
 * le tarif €/kg legacy du CLIENT si pas de grille. Réservé direction / admin
 * (rapport de gestion). GET (aucun effet de bord).
 */

type ListedLine = { ItemCode?: string; Quantity?: number };
type SapOrderListed = {
  DocEntry: number;
  DocDueDate?: string;
  Cancelled?: string;
  CardCode?: string;
  CardName?: string;
  U_TrspCode?: string;
  DocumentLines?: ListedLine[];
};

const r2 = (n: number) => Math.round(n * 100) / 100;
const r3 = (n: number) => Math.round(n * 1000) / 1000;

export async function GET() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  if (!(await requireAdmin(session))) {
    return NextResponse.json({ error: "Réservé à la direction / aux administrateurs" }, { status: 403 });
  }

  const model = await getTransportModel();
  const metrics = computeTransportMetrics(model);
  const prixPosition = metrics.prixPositionPerKg;

  // Fenêtre 12 mois glissants (DocDueDate).
  const fmtDate = (d: Date) => d.toISOString().slice(0, 10);
  const now = new Date();
  const from = new Date(now);
  from.setFullYear(from.getFullYear() - 1);
  from.setDate(from.getDate() + 1);
  const fromStr = fmtDate(from);
  const toStr = fmtDate(now);

  const filterExpr = `DocDueDate ge '${fromStr}' and DocDueDate le '${toStr}'`;
  const select = "DocEntry,DocDueDate,Cancelled,CardCode,CardName,U_TrspCode,DocumentLines";
  const MAX_PAGES = 300;

  let orders: SapOrderListed[] = [];
  try {
    orders = await sap.getAll<SapOrderListed>(
      `Orders?$select=${select}&$filter=${encodeURIComponent(filterExpr)}&$orderby=DocEntry asc`,
      { pageSize: 200, maxPages: MAX_PAGES },
    );
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: `Requête SAP impossible : ${e instanceof Error ? e.message : String(e)}` },
      { status: 502 },
    );
  }
  const live = orders.filter((o) => o.Cancelled !== "tYES");
  const truncated = orders.length >= MAX_PAGES * 200;

  // Poids par article (cache local).
  const itemCodes = [...new Set(live.flatMap((o) => (o.DocumentLines ?? []).map((l) => l.ItemCode).filter((c): c is string => !!c)))];
  const weightByCode = new Map<string, number>();
  if (itemCodes.length) {
    const prods = await prisma.product.findMany({ where: { itemCode: { in: itemCodes } }, select: { itemCode: true, salesUnitWeight: true } });
    for (const p of prods) weightByCode.set(p.itemCode, p.salesUnitWeight ?? 0);
  }

  // Fiches clients (CardCode → id/nom/type/département) + tarifs legacy par
  // client + GRILLES par transporteur (coût par position — lib/carrierTariff).
  const cardCodes = [...new Set(live.map((o) => o.CardCode).filter((c): c is string => !!c))];
  const clientByCard = new Map<string, { id: string; nom: string; type: string | null; dept: string | null }>();
  if (cardCodes.length) {
    const clients = await prisma.client.findMany({ where: { code: { in: cardCodes } }, select: { id: true, code: true, nom: true, type: true, zipCode: true } });
    for (const c of clients) clientByCard.set(c.code, { id: c.id, nom: c.nom, type: c.type, dept: departementOfZip(c.zipCode) });
  }
  const pricingById = new Map<string, ClientCarrierPricing>();
  try {
    const rows = await prisma.appSetting.findMany({ where: { key: { startsWith: "transportcli:" } } });
    for (const row of rows) {
      const id = row.key.slice("transportcli:".length);
      try { pricingById.set(id, sanitizeClientPricing(JSON.parse(row.value))); } catch { /* ignore */ }
    }
  } catch { /* pas de tarifs */ }
  const carrierTariffs = await listCarrierTariffs();

  // Agrégation.
  type CarrierAgg = { code: string; deliveries: number; kg: number; cost: number; direct: boolean };
  type ClientAgg = { cardCode: string; name: string; deliveries: number; kg: number; cost: number; directKg: number; extKg: number };
  const byCarrier = new Map<string, CarrierAgg>();
  const byClient = new Map<string, ClientAgg>();
  let totalKg = 0, totalCost = 0;

  for (const o of live) {
    const code = normCarrier(o.U_TrspCode) || "(AUCUN)";
    const kg = (o.DocumentLines ?? []).reduce((s, l) => s + (l.Quantity || 0) * (weightByCode.get(l.ItemCode ?? "") ?? 0), 0);
    const card = o.CardCode ?? "";
    const cli = card ? clientByCard.get(card) : undefined;
    const pricing = cli ? pricingById.get(cli.id) ?? null : null;
    const direct = isDirectCarrier(model, code) || (model.directCarriers.length === 0);
    // Externe avec GRILLE : coût par position (tranche de poids × département
    // du client). Repli : legacy €/kg (client) × kg, ou prix position (direct).
    const posCost = !direct ? computePositionCost(carrierTariffs[code] ?? null, cli?.dept, kg) : null;
    const cost = posCost ? posCost.total : transportPerKgForCarrier(model, prixPosition, code, pricing) * kg;

    totalKg += kg; totalCost += cost;

    const c = byCarrier.get(code) ?? { code, deliveries: 0, kg: 0, cost: 0, direct };
    c.deliveries += 1; c.kg += kg; c.cost += cost;
    byCarrier.set(code, c);

    if (card) {
      const name = cli?.nom ?? o.CardName ?? card;
      const cl = byClient.get(card) ?? { cardCode: card, name, deliveries: 0, kg: 0, cost: 0, directKg: 0, extKg: 0 };
      cl.deliveries += 1; cl.kg += kg; cl.cost += cost;
      if (direct) cl.directKg += kg; else cl.extKg += kg;
      byClient.set(card, cl);
    }
  }

  const carriers = [...byCarrier.values()]
    .map((c) => ({ ...c, kg: r2(c.kg), cost: r2(c.cost), perKg: c.kg > 0 ? r3(c.cost / c.kg) : 0 }))
    .sort((a, b) => b.cost - a.cost || b.kg - a.kg);
  const clients = [...byClient.values()]
    .map((c) => ({ ...c, kg: r2(c.kg), cost: r2(c.cost), directKg: r2(c.directKg), extKg: r2(c.extKg), perKg: c.kg > 0 ? r3(c.cost / c.kg) : 0 }))
    .sort((a, b) => b.cost - a.cost || b.kg - a.kg)
    .slice(0, 100);

  return NextResponse.json({
    ok: true,
    from: fromStr,
    to: toStr,
    window: "12 mois glissants",
    prixPositionPerKg: r3(prixPosition),
    annualCost: r2(metrics.annualCost),
    totals: { deliveries: live.length, kg: r2(totalKg), cost: r2(totalCost) },
    carriers,
    clients,
    truncated,
  });
}
