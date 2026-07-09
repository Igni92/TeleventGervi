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
 * Livraisons EN DIRECT, calculées depuis les BL SAP et ANNUALISÉES.
 *
 * POST /api/transport/direct-deliveries { apply?, carriers?, since? }
 *   - Prend les BL (DocDueDate) chez un transporteur « direct », DEPUIS LE
 *     PREMIER BL en direct (auto-détecté) — surtout PAS les mois d'avant où
 *     l'on ne livrait pas en direct, sinon le €/kg est faussé ;
 *   - somme livraisons + POIDS (Σ ligne.Quantity × Product.salesUnitWeight)
 *     sur cette période réelle, puis ANNUALISE (× 365,25 / nb jours) pour
 *     obtenir un volume annuel comparable au coût annuel ;
 *   - si `apply` (défaut true) : écrit deliveriesPerYear / kgPerYear (annualisés)
 *     dans le modèle.
 *   - `since` (YYYY-MM-DD, optionnel) force la date de départ ; sinon on part du
 *     1er BL direct trouvé sur les 36 derniers mois.
 *
 * Les transporteurs « directs » viennent du modèle (directCarriers). Réservé
 * direction / admin.
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

  let body: { apply?: unknown; carriers?: unknown; since?: unknown } = {};
  try { body = await req.json(); } catch { /* corps optionnel */ }

  const apply = body.apply !== false; // défaut : on écrit dans le modèle

  // ── Fenêtre de RECHERCHE : `since` fourni, sinon 36 mois de recul (on
  //    trouvera dedans le 1er BL direct réel). On borne juste la requête SAP. ──
  const fmtDate = (d: Date) => d.toISOString().slice(0, 10);
  const now = new Date();
  const sinceStr = typeof body.since === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.since) ? body.since : null;
  const from = new Date(now);
  if (sinceStr) { from.setTime(new Date(`${sinceStr}T00:00:00Z`).getTime()); }
  else { from.setFullYear(from.getFullYear() - 3); }
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

  // Filtre SAP : BL de la fenêtre de recherche (DocDueDate) chez un transporteur direct.
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
  let firstMs = Number.POSITIVE_INFINITY;
  const byCarrier: Record<string, { deliveries: number; kg: number }> = {};
  for (const o of live) {
    const code = normCarrier(o.U_TrspCode);
    const w = (o.DocumentLines ?? []).reduce((s, l) => s + (l.Quantity || 0) * (weightByCode.get(l.ItemCode ?? "") ?? 0), 0);
    kg += w;
    const t = o.DocDueDate ? new Date(o.DocDueDate).getTime() : NaN;
    if (Number.isFinite(t) && t < firstMs) firstMs = t;
    const b = byCarrier[code] ?? { deliveries: 0, kg: 0 };
    b.deliveries += 1;
    b.kg += w;
    byCarrier[code] = b;
  }
  const rawDeliveries = live.length;
  const rawKg = Math.round(kg * 100) / 100;

  // ── Période réelle = du 1er BL direct à aujourd'hui ; ANNUALISATION ──
  const firstBl = Number.isFinite(firstMs) ? fmtDate(new Date(firstMs)) : null;
  const spanDays = firstBl
    ? Math.max(1, Math.round((now.getTime() - firstMs) / 86_400_000) + 1)
    : 0;
  const factor = spanDays > 0 ? 365.25 / spanDays : 0;
  const deliveries = Math.round(rawDeliveries * factor);
  const kgAnnual = Math.round(rawKg * factor * 100) / 100;
  // Fiabilité : au moins ~6 semaines d'historique direct pour annualiser sereinement.
  const reliable = spanDays >= 45;

  let saved = false;
  if (apply && rawDeliveries > 0) {
    model.deliveriesPerYear = deliveries;
    model.kgPerYear = kgAnnual;
    model.updatedAt = new Date().toISOString();
    model.updatedBy = session.user.email ?? session.user.name ?? null;
    try { await setTransportModel(model); saved = true; } catch { /* on renvoie quand même les totaux */ }
  }

  return NextResponse.json({
    ok: true,
    since: firstBl,
    to: toStr,
    searchedFrom: fromStr,
    spanDays,
    annualizationFactor: Math.round(factor * 100) / 100,
    reliable,
    // Sur la période réelle (depuis le 1er BL direct) :
    rawDeliveries,
    rawKg,
    // Annualisés (ce qui est stocké) :
    deliveries,
    kg: kgAnnual,
    carriers: directCodes,
    byCarrier: Object.fromEntries(Object.entries(byCarrier).map(([k, v]) => [k, { deliveries: v.deliveries, kg: Math.round(v.kg * 100) / 100 }])),
    truncated,
    saved,
    ...(apply ? { model } : {}),
  });
}
