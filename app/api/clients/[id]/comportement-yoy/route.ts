import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { auth } from "@/lib/auth";
import { getAccessScope, clientInScope } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { cardCodesOf } from "@/lib/clientCardCodes";

/**
 * GET /api/clients/[id]/comportement-yoy
 *
 * Analyse comportementale du client : volume (pcs), CA HT (€), nb commandes
 * (Invoices) sur **N vs N-1**, **même période YTD** (du 1er janvier à
 * aujourd'hui). Source = SapInvoice/SapInvoiceLine (mirror SAP local).
 *
 * Pourquoi YTD : permet la comparaison "à ce jour, ce client tourne comment
 * vs même intervalle l'an dernier" — c'est la vraie question commerciale, et
 * ça neutralise la saisonnalité (on compare la même fenêtre).
 *
 * Couvre tous les cardCodes du client (principal + ClientDeliveryMode), comme
 * /api/sap/clients/[id]/habits, pour ne pas perdre les ventes SCACHAP/Direct.
 *
 * Cancelled + isService exclus du CA mais on garde le compte des factures
 * cancelled séparé (audit). nb commandes = nb Invoices distincts non
 * cancelled (= métier : nb de BL facturés).
 */

type Agg = { kg: number; ca: number; nbOrders: number };

async function aggregate(
  cardCodes: string[],
  from: Date,
  to: Date,
): Promise<Agg> {
  // Volume en kg = SUM(quantity × salesUnitWeight). LEFT JOIN Product pour ne
  // pas exclure les lignes dont l'item n'existe pas en cache local (le poids
  // sera 0, le CA et nbOrders restent corrects).
  const [row] = await prisma.$queryRaw<Array<{
    kg: number | null;
    ca: number | null;
    nbOrders: number | bigint | null;
  }>>(Prisma.sql`
    SELECT
      COALESCE(SUM(l."quantity" * COALESCE(p."salesUnitWeight", 0)), 0)::float AS "kg",
      COALESCE(SUM(l."lineTotal"), 0)::float                                   AS "ca",
      COUNT(DISTINCT i."docEntry")::int                                        AS "nbOrders"
    FROM "SapInvoice"     AS i
    LEFT JOIN "SapInvoiceLine" AS l ON l."docEntry" = i."docEntry" AND l."isService" = false
    LEFT JOIN "Product"        AS p ON p."itemCode" = l."itemCode"
    WHERE i."cardCode" IN (${Prisma.join(cardCodes)})
      AND i."docDate" BETWEEN ${from} AND ${to}
      AND i."cancelled" = false;
  `);
  return {
    kg: row?.kg ?? 0,
    ca: row?.ca ?? 0,
    nbOrders: Number(row?.nbOrders ?? 0),
  };
}

export async function GET(_: Request, { params }: { params: { id: string } }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  if (!(await clientInScope(await getAccessScope(session), params.id)))
    return NextResponse.json({ error: "Accès refusé à ce client." }, { status: 403 });

  const client = await prisma.client.findUnique({
    where: { id: params.id },
    select: { code: true, deliveryModes: { select: { sapCardCode: true } } },
  });
  if (!client) return NextResponse.json({ error: "Client introuvable" }, { status: 404 });

  const cardCodes = cardCodesOf(client);

  const now = new Date();
  const yearN = now.getUTCFullYear();
  const startN = new Date(Date.UTC(yearN, 0, 1));
  const endN = new Date(Date.UTC(yearN, now.getUTCMonth(), now.getUTCDate(), 23, 59, 59));
  const startN1 = new Date(Date.UTC(yearN - 1, 0, 1));
  const endN1 = new Date(Date.UTC(yearN - 1, now.getUTCMonth(), now.getUTCDate(), 23, 59, 59));

  const [curr, prev] = await Promise.all([
    aggregate(cardCodes, startN, endN),
    aggregate(cardCodes, startN1, endN1),
  ]);

  return NextResponse.json({
    ok: true,
    period: {
      currentYear: yearN,
      previousYear: yearN - 1,
      from: startN.toISOString().slice(0, 10),
      to: endN.toISOString().slice(0, 10),
    },
    current: curr,
    previous: prev,
  });
}
