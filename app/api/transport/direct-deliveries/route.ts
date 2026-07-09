import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { requireAdmin } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { sap } from "@/lib/sapb1";
import { getTransportModel, setTransportModel } from "@/lib/transportCostStore";
import { normCarrier } from "@/lib/transportCost";

export const dynamic = "force-dynamic";
// Agrégation sur une année de BL : laisser le temps à SAP (Vercel Pro).
export const maxDuration = 300;

/**
 * Livraisons EN DIRECT d'une année, calculées depuis les BL SAP.
 *
 * POST /api/transport/direct-deliveries { year?, apply?, carriers? }
 *   - Compte les commandes (BL) dont la date de LIVRAISON (DocDueDate) tombe
 *     dans l'année et dont le transporteur (U_TrspCode) est « direct » ;
 *   - somme le POIDS (Σ ligne.Quantity × Product.salesUnitWeight) ;
 *   - si `apply` (défaut true) : écrit deliveriesPerYear / kgPerYear dans le
 *     modèle de coût de transport.
 *
 * Les transporteurs « directs » viennent du modèle (directCarriers) — on y
 * inclut aussi bien le NOUVEAU code (« DIRECT IDF ») que l'ANCIEN
 * (« GERVIFRAIS IDF ») : le calcul additionne les deux. Réservé direction/admin.
 */

type ListedLine = { ItemCode?: string; Quantity?: number };
type SapOrderListed = {
  DocEntry: number;
  DocDueDate?: string;
  Cancelled?: string;
  U_TrspCode?: string;
  DocumentLines?: ListedLine[];
};

/** Échappe une valeur pour un littéral OData (') → doublé (''). */
const odataStr = (s: string) => `'${s.replace(/'/g, "''")}'`;

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  if (!(await requireAdmin(session))) {
    return NextResponse.json({ error: "Réservé à la direction / aux administrateurs" }, { status: 403 });
  }

  let body: { apply?: unknown; carriers?: unknown } = {};
  try { body = await req.json(); } catch { /* corps optionnel */ }

  const apply = body.apply !== false; // défaut : on écrit dans le modèle

  // ── Fenêtre : ANNÉE GLISSANTE (12 derniers mois, DocDueDate) ──
  const fmtDate = (d: Date) => d.toISOString().slice(0, 10);
  const now = new Date();
  const from = new Date(now);
  from.setFullYear(from.getFullYear() - 1);
  from.setDate(from.getDate() + 1);
  const fromStr = fmtDate(from);
  const toStr = fmtDate(now);

  const model = await getTransportModel();
  const carriersRaw = Array.isArray(body.carriers) && body.carriers.length
    ? (body.carriers as unknown[]).map((c) => normCarrier(String(c ?? "")))
    : model.directCarriers.map(normCarrier);
  const directCodes = [...new Set(carriersRaw.filter(Boolean))];
  if (directCodes.length === 0) {
    return NextResponse.json(
      { error: "Aucun transporteur « direct » n'est paramétré. Marque d'abord tes transporteurs directs (page Coût de transport)." },
      { status: 400 },
    );
  }

  // Filtre SAP : livraisons des 12 derniers mois (DocDueDate) chez un transporteur direct.
  const carrierClause = directCodes.map((c) => `U_TrspCode eq ${odataStr(c)}`).join(" or ");
  const filterExpr =
    `DocDueDate ge '${fromStr}' and DocDueDate le '${toStr}' and (${carrierClause})`;
  const select = "DocEntry,DocDueDate,Cancelled,U_TrspCode,DocumentLines";
  const MAX_PAGES = 200; // 200 × 200 = 40 000 BL max

  let orders: SapOrderListed[] = [];
  try {
    orders = await sap.getAll<SapOrderListed>(
      `Orders?$select=${select}&$filter=${encodeURIComponent(filterExpr)}&$orderby=DocEntry asc`,
      { pageSize: 200, maxPages: MAX_PAGES },
    );
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: `Requête SAP impossible (filtre transporteur ?) : ${e instanceof Error ? e.message : String(e)}` },
      { status: 502 },
    );
  }

  // Garde-fous : non annulés + re-filtre transporteur côté serveur (au cas où le
  // $filter UDF serait ignoré par certaines versions du Service Layer).
  const directSet = new Set(directCodes);
  const live = orders.filter((o) => o.Cancelled !== "tYES" && directSet.has(normCarrier(o.U_TrspCode)));
  const truncated = orders.length >= MAX_PAGES * 200;

  // Poids : Σ ligne.Quantity × Product.salesUnitWeight (cache local des articles).
  const itemCodes = [...new Set(live.flatMap((o) => (o.DocumentLines ?? []).map((l) => l.ItemCode).filter((c): c is string => !!c)))];
  const weightByCode = new Map<string, number>();
  if (itemCodes.length) {
    const prods = await prisma.product.findMany({
      where: { itemCode: { in: itemCodes } },
      select: { itemCode: true, salesUnitWeight: true },
    });
    for (const p of prods) weightByCode.set(p.itemCode, p.salesUnitWeight ?? 0);
  }

  let kg = 0;
  const byCarrier: Record<string, { deliveries: number; kg: number }> = {};
  for (const o of live) {
    const code = normCarrier(o.U_TrspCode);
    const w = (o.DocumentLines ?? []).reduce((s, l) => s + (l.Quantity || 0) * (weightByCode.get(l.ItemCode ?? "") ?? 0), 0);
    kg += w;
    const b = byCarrier[code] ?? { deliveries: 0, kg: 0 };
    b.deliveries += 1;
    b.kg += w;
    byCarrier[code] = b;
  }
  const deliveries = live.length;
  const kgRounded = Math.round(kg * 100) / 100;

  let saved = false;
  if (apply) {
    model.deliveriesPerYear = deliveries;
    model.kgPerYear = kgRounded;
    model.updatedAt = new Date().toISOString();
    model.updatedBy = session.user.email ?? session.user.name ?? null;
    try { await setTransportModel(model); saved = true; } catch { /* on renvoie quand même les totaux */ }
  }

  return NextResponse.json({
    ok: true,
    from: fromStr,
    to: toStr,
    window: "12 mois glissants",
    deliveries,
    kg: kgRounded,
    carriers: directCodes,
    byCarrier: Object.fromEntries(Object.entries(byCarrier).map(([k, v]) => [k, { deliveries: v.deliveries, kg: Math.round(v.kg * 100) / 100 }])),
    truncated,
    saved,
    ...(apply ? { model } : {}),
  });
}
