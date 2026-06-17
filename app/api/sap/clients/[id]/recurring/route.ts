import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { auth } from "@/lib/auth";
import { getAccessScope, clientInScope } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";

/**
 * GET /api/sap/clients/[id]/recurring
 *
 * « Produits récurrents » du client : top N articles que CE client commande le
 * plus souvent (récurrence d'achat), pour aider la télévente à proposer le
 * réassort. Source = historique facturé mirroré (SapInvoice/SapInvoiceLine ⋈
 * Product), scopé sur les cardCodes du client (principal + ClientDeliveryMode,
 * comme /api/sap/clients/[id]/habits et /api/clients/[id]/familles-vs-groupe).
 *
 * Classement = fréquence (nb de factures distinctes contenant l'article) puis
 * volume cumulé (kg = Σ quantity × salesUnitWeight). On renvoie aussi la qté
 * cumulée (pièces), le nb de factures et la date de dernière commande.
 *
 * Scope : on réutilise clientInScope (cf. habits) — hors scope → 403.
 * Lignes de service exclues (isService = true). Factures annulées exclues.
 */
const DEFAULT_TOP = 8;

export async function GET(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  if (!(await clientInScope(await getAccessScope(session), params.id)))
    return NextResponse.json({ error: "Accès refusé à ce client." }, { status: 403 });

  const clientId = params.id;
  if (!clientId) return NextResponse.json({ error: "clientId requis" }, { status: 400 });

  const topN = Math.min(
    20,
    Math.max(1, Number(new URL(req.url).searchParams.get("top")) || DEFAULT_TOP),
  );

  // Tous les CardCodes du client (principal + modes de livraison) — même
  // résolution que habits/route.ts et familles-vs-groupe/route.ts.
  const client = await prisma.client.findUnique({
    where: { id: clientId },
    select: { code: true, deliveryModes: { select: { sapCardCode: true } } },
  });
  if (!client) return NextResponse.json({ error: "Client introuvable" }, { status: 404 });

  const cardCodes = Array.from(
    new Set<string>([client.code, ...client.deliveryModes.map((m) => m.sapCardCode).filter(Boolean)]),
  );
  if (cardCodes.length === 0) {
    return NextResponse.json({ ok: true, items: [] });
  }

  // Agrégation par itemCode : nb factures distinctes (fréquence), qté cumulée
  // (pièces), volume cumulé (kg via salesUnitWeight, 0 si poids inconnu) et
  // dernière date de facturation. LEFT JOIN Product pour ne pas perdre les
  // lignes sans cache produit local.
  const rows = await prisma.$queryRaw<Array<{
    itemCode: string;
    itemName: string | null;
    invoiceCount: number | bigint;
    qty: number | null;
    weightKg: number | null;
    lastDate: Date | null;
  }>>(Prisma.sql`
    SELECT
      l."itemCode"                                                              AS "itemCode",
      MAX(COALESCE(p."itemName", l."itemDescription"))                          AS "itemName",
      COUNT(DISTINCT i."docEntry")                                              AS "invoiceCount",
      COALESCE(SUM(l."quantity"), 0)::float                                     AS "qty",
      COALESCE(SUM(l."quantity" * COALESCE(p."salesUnitWeight", 0)), 0)::float  AS "weightKg",
      MAX(i."docDate")                                                          AS "lastDate"
    FROM "SapInvoice"     AS i
    JOIN "SapInvoiceLine" AS l ON l."docEntry" = i."docEntry"
    LEFT JOIN "Product"   AS p ON p."itemCode" = l."itemCode"
    WHERE i."cardCode" IN (${Prisma.join(cardCodes)})
      AND i."cancelled" = false
      AND l."isService" = false
      AND l."itemCode" IS NOT NULL
    GROUP BY l."itemCode"
    ORDER BY "invoiceCount" DESC, "weightKg" DESC
    LIMIT ${topN};
  `);

  return NextResponse.json({
    ok: true,
    items: rows.map((r) => ({
      itemCode: r.itemCode,
      itemName: r.itemName ?? r.itemCode,
      invoiceCount: Number(r.invoiceCount),
      qty: Math.round((r.qty ?? 0) * 10) / 10,
      weightKg: Math.round((r.weightKg ?? 0) * 10) / 10,
      lastDate: r.lastDate ? r.lastDate.toISOString() : null,
    })),
  });
}
