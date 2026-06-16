import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getAccessScope } from "@/lib/permissions";

/**
 * GET /api/sap/clients/[id]/recurring
 *
 * « Produits récurrents » du client : top N articles que CE client commande le
 * plus souvent, dérivé de l'historique facturé mirroré (SapInvoice/
 * SapInvoiceLine ⋈ Product), scopé sur les cardCodes du client (principal +
 * ClientDeliveryMode — comme /api/sap/clients/[id]/habits et comportement-yoy).
 *
 * Classement = fréquence (nb de factures distinctes contenant l'article) puis
 * volume cumulé (kg = Σ quantity × salesUnitWeight). On renvoie aussi la qté
 * cumulée (pièces) et le nb de factures.
 *
 * Scope : un commercial (non admin) ne voit que SES clients
 * (Client.commercial = slpName OU Client.vendeur = slpName), cf. lib/permissions.ts.
 * Hors scope → 403.
 *
 * Lignes de service exclues (isService = true). Lignes annulées exclues.
 */
const DEFAULT_TOP = 8;

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

  const clientId = params.id;
  if (!clientId) return NextResponse.json({ error: "clientId requis" }, { status: 400 });

  const topN = Math.min(
    20,
    Math.max(1, Number(new URL(req.url).searchParams.get("top")) || DEFAULT_TOP),
  );

  const client = await prisma.client.findUnique({
    where: { id: clientId },
    select: { code: true, deliveryModes: { select: { sapCardCode: true } } },
  });
  if (!client) return NextResponse.json({ error: "Client introuvable" }, { status: 404 });

  // Scope slpName : le commercial ne voit que ses clients.
  const scope = await getAccessScope(session);
  if (!scope.all) {
    if (!scope.slpName) {
      return NextResponse.json({ error: "Accès restreint" }, { status: 403 });
    }
    const rows = await prisma.$queryRaw<{ id: string }[]>(
      Prisma.sql`SELECT "id" FROM "Client"
                 WHERE "id" = ${clientId}
                   AND ("commercial" = ${scope.slpName} OR "vendeur" = ${scope.slpName})
                 LIMIT 1`,
    );
    if (rows.length === 0) {
      return NextResponse.json({ error: "Accès restreint" }, { status: 403 });
    }
  }

  const cardCodes = Array.from(
    new Set<string>([client.code, ...client.deliveryModes.map((m) => m.sapCardCode).filter(Boolean)]),
  );
  if (cardCodes.length === 0) {
    return NextResponse.json({ ok: true, items: [] });
  }

  // Agrégation par itemCode : nb factures distinctes (fréquence), qté cumulée
  // (pièces) et volume cumulé (kg via salesUnitWeight, 0 si poids inconnu).
  // LEFT JOIN Product pour ne pas perdre les lignes sans cache produit local.
  const rows = await prisma.$queryRaw<Array<{
    itemCode: string;
    itemName: string | null;
    invoiceCount: number | bigint;
    qty: number | null;
    weightKg: number | null;
  }>>(Prisma.sql`
    SELECT
      l."itemCode"                                                              AS "itemCode",
      MAX(COALESCE(p."itemName", l."itemDescription"))                          AS "itemName",
      COUNT(DISTINCT i."docEntry")                                             AS "invoiceCount",
      COALESCE(SUM(l."quantity"), 0)::float                                    AS "qty",
      COALESCE(SUM(l."quantity" * COALESCE(p."salesUnitWeight", 0)), 0)::float AS "weightKg"
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
    })),
  });
}
