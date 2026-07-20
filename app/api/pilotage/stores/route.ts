import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { auth } from "@/lib/auth";
import { getAccessScope, resolvePilotageView, scopePayload } from "@/lib/permissions";
import { topClients, invoiceWeightByCard } from "@/lib/pilotage";
import { prisma } from "@/lib/prisma";
import { grossMarginPct } from "@/lib/margin";
import { segmentOfGroup, groupCodesForSegment, parseSegment, type ClientSegment } from "@/lib/segments";
import { loadDocTransportContext, docTransportCost } from "@/lib/transportDoc";
import { cached, invalidate } from "@/lib/ttlCache";

// Évite le timeout serverless sur les agrégations (cold start Vercel).
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * GET /api/pilotage/stores?segment=ALL|GMS|CHR|EXPORT|RUNGIS|MIN_RUNGIS[&refresh=1]
 *
 * PALMARÈS DES MAGASINS — rentabilité par client sur les 12 derniers mois
 * glissants. Source SapInvoice (le facturé fait foi, comme le rapport annuel).
 *
 * Par magasin on renvoie :
 *   • CA HT (Σ DocTotal) + nb de factures,
 *   • marge BRUTE € (coût EM réel, lib/cogs) + CA produit net (base marge %),
 *   • poids livré (kg),
 *   • COÛT TRANSPORT PAR POSITION, facture par facture (lib/transportDoc) :
 *     transporteur RÉEL du document (U_TrspCode mirroré), repli tournée
 *     habituelle — direct = coût/position, externe = grille département ×
 *     tranche de poids. Export/enlèvements (transporteur payé par le client ou
 *     inconnu) restent à 0,
 *   • MARGE NETTE = marge brute − coût transport (le « vrai » gain du magasin).
 *
 * Périmètre commercial identique au reste du pilotage : un non-admin (ou un
 * admin « voir comme ») ne voit que ses clients (slpName). Cache hebdo par
 * périmètre + segment ; ?refresh=1 force le recalcul.
 */

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
// Nb de magasins classés — les gros grossistes tournent à quelques centaines de
// comptes actifs ; 250 par CA couvre tout le portefeuille utile sans surcharger
// les 2 GROUP BY marge (restreints à ces codes).
const MAX_STORES = 250;

interface StoreRow {
  cardCode: string;
  cardName: string | null;
  segment: ClientSegment | null;
  /** true si segment livré en propre (GMS/CHR) → coût transport estimé applicable. */
  delivered: boolean;
  ca: number;
  caProductNet: number;
  invoices: number;
  weightKg: number;
  marginGross: number;
  marginGrossPct: number;
  transportCost: number;
  /** Part du CA (HT) absorbée par le transport. */
  transportPctCa: number;
  /** Part de la marge BRUTE absorbée par le transport (null si marge ≤ 0). */
  transportPctMargin: number | null;
  marginNet: number;
  marginNetPct: number;
}

export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

  const url = new URL(req.url);
  const scope = await getAccessScope(session);
  const { slp } = resolvePilotageView(scope, url.searchParams.get("as"));
  const segment = parseSegment(url.searchParams.get("segment"));

  const cacheKey = `pilotage:stores:${slp ?? "ALL"}:${segment}`;
  if (url.searchParams.get("refresh") === "1") invalidate(cacheKey);

  const payload = await cached(cacheKey, WEEK_MS, async () => {
    // Fenêtre : 12 mois glissants (mois entiers), alignée sur la carte géo.
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth() - 11, 1);
    const end = new Date(now.getFullYear(), now.getMonth() + 1, 1);

    const groupCodes = groupCodesForSegment(segment);

    // Classement par CA (top 250) + marge réelle restreinte à ces codes.
    const clients = await topClients(start, end, MAX_STORES, groupCodes, slp);
    const codes = clients.map((c) => c.cardCode);

    const [weightByCard, bps, perDoc] = await Promise.all([
      invoiceWeightByCard(start, end, codes, slp),
      codes.length
        ? prisma.sapBusinessPartner.findMany({
            where: { cardCode: { in: codes } },
            select: { cardCode: true, groupCode: true, groupName: true },
          })
        : Promise.resolve([]),
      // PAR FACTURE : poids livré + transporteur réel + localisation du client
      // (le coût par position dépend du poids de CHAQUE livraison).
      codes.length
        ? prisma.$queryRaw<{ card: string; trsp: string | null; cid: string | null; zip: string | null; kg: number }[]>(Prisma.sql`
            SELECT i."cardCode" AS card, i."trspCode" AS trsp, cl."id" AS cid, cl."zipCode" AS zip,
                   COALESCE(SUM(l."quantity" * COALESCE(p."salesUnitWeight", 0)), 0)::float AS kg
            FROM "SapInvoice" i
            LEFT JOIN "Client" cl ON cl."code" = i."cardCode"
            LEFT JOIN "SapInvoiceLine" l ON l."docEntry" = i."docEntry"
            LEFT JOIN "Product" p ON p."itemCode" = l."itemCode"
            WHERE i."cancelled" = false AND i."docDate" >= ${start} AND i."docDate" < ${end}
              AND i."cardCode" IN (${Prisma.join(codes)})
              ${slp ? Prisma.sql`AND i."slpName" = ${slp}` : Prisma.empty}
            GROUP BY i."docEntry", 1, 2, 3, 4`)
        : Promise.resolve([]),
    ]);

    const groupByCode = new Map(bps.map((b) => [b.cardCode, { groupCode: b.groupCode, groupName: b.groupName }]));

    // Coût transport par POSITION, facture par facture (transporteur réel du
    // doc → repli tournée habituelle), sommé par magasin.
    const ctx = await loadDocTransportContext(codes);
    const transportConfigured = ctx.costPerDelivery > 0 || ctx.prixPositionPerKg > 0;
    const transportByCard = new Map<string, number>();
    for (const d of perDoc) {
      const t = docTransportCost(ctx, { cardCode: d.card, clientId: d.cid, zip: d.zip, kg: Number(d.kg), trspCode: d.trsp });
      if (t.cost > 0) transportByCard.set(d.card, (transportByCard.get(d.card) ?? 0) + t.cost);
    }

    const stores: StoreRow[] = clients.map((c) => {
      const g = groupByCode.get(c.cardCode);
      const seg = segmentOfGroup(g?.groupName ?? null, g?.groupCode ?? null);
      const weightKg = weightByCard.get(c.cardCode) ?? 0;
      const transportCost = Math.round((transportByCard.get(c.cardCode) ?? 0) * 100) / 100;
      // « delivered » = un coût de livraison interne existe réellement.
      const delivered = transportCost > 0;
      const marginGross = c.margin;
      const marginNet = marginGross - transportCost;
      return {
        cardCode: c.cardCode,
        cardName: c.cardName,
        segment: seg,
        delivered,
        ca: c.ca,
        caProductNet: c.caProductNet,
        invoices: c.invoices,
        weightKg,
        marginGross,
        marginGrossPct: grossMarginPct(marginGross, c.caProductNet),
        transportCost,
        transportPctCa: c.ca > 0 ? (transportCost / c.ca) * 100 : 0,
        transportPctMargin: marginGross > 0 ? (transportCost / marginGross) * 100 : null,
        marginNet,
        marginNetPct: c.caProductNet > 0 ? (marginNet / c.caProductNet) * 100 : 0,
      };
    });

    // Totaux du périmètre affiché (base des KPI héros).
    const totals = stores.reduce(
      (t, s) => {
        t.ca += s.ca;
        t.caProductNet += s.caProductNet;
        t.weightKg += s.weightKg;
        t.marginGross += s.marginGross;
        t.transportCost += s.transportCost;
        t.marginNet += s.marginNet;
        return t;
      },
      { ca: 0, caProductNet: 0, weightKg: 0, marginGross: 0, transportCost: 0, marginNet: 0 },
    );

    return {
      period: { start: start.toISOString(), end: end.toISOString() },
      segment,
      prixPositionPerKg: ctx.prixPositionPerKg,
      /** Direct : coût PAR POSITION (annuel ÷ livraisons) appliqué par facture. */
      costPerDelivery: ctx.costPerDelivery,
      transportConfigured,
      nbStores: stores.length,
      totals: {
        ...totals,
        marginGrossPct: grossMarginPct(totals.marginGross, totals.caProductNet),
        marginNetPct: totals.caProductNet > 0 ? (totals.marginNet / totals.caProductNet) * 100 : 0,
        transportPctMargin: totals.marginGross > 0 ? (totals.transportCost / totals.marginGross) * 100 : null,
      },
      stores,
    };
  });

  return NextResponse.json({ ...payload, scope: scopePayload(scope) });
}
