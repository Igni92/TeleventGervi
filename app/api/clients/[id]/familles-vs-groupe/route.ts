import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { FAMILY_CTE_SQL } from "@/lib/familles";

/**
 * GET /api/clients/[id]/familles-vs-groupe
 *
 * Fiche client : top 8 **familles effectives** régulières du client sur N-1,
 * comparées à la **médiane** des autres clients du **même sapGroupCode**.
 *
 * Évolutions depuis v1 :
 *   - Volume en **kg** (poids = SUM(quantity * salesUnitWeight)) — l'unité
 *     métier chez TeleVent c'est le kilo, pas la pièce.
 *   - **Sous-groupes fruits rouges** : myrtille/groseille/mûre/framboise/cassis
 *     séparés, fraises fusionnées (cf. backlog A4 + helper `lib/familles.ts`).
 *
 * Choix conservés : médiane robuste, dead-band ±10 %, période N-1 calendaire,
 * pairs = mêmes sapGroupCode hors cardCodes du client.
 */

const TOP_N = 8;
const DEAD_BAND = 0.10;

type FamilyRow = {
  familyKey: string;
  familyLabel: string | null;
  kg: number;
};

type PeerRow = {
  cardCode: string;
  familyKey: string;
  kg: number;
};

function median(xs: number[]): number {
  if (xs.length === 0) return 0;
  const sorted = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

export async function GET(_: Request, { params }: { params: { id: string } }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

  const client = await prisma.client.findUnique({
    where: { id: params.id },
    select: { code: true, sapGroupCode: true, sapGroupName: true, deliveryModes: { select: { sapCardCode: true } } },
  });
  if (!client) return NextResponse.json({ error: "Client introuvable" }, { status: 404 });

  if (client.sapGroupCode == null) {
    return NextResponse.json({ ok: true, reason: "no-group", families: [], groupSize: 0 });
  }

  const clientCardCodes = Array.from(
    new Set<string>([client.code, ...client.deliveryModes.map((m) => m.sapCardCode).filter(Boolean)]),
  );

  const yearMinus1 = new Date().getFullYear() - 1;
  const periodStart = new Date(Date.UTC(yearMinus1, 0, 1));
  const periodEnd = new Date(Date.UTC(yearMinus1, 11, 31, 23, 59, 59));

  const peers = await prisma.sapBusinessPartner.findMany({
    where: {
      groupCode: client.sapGroupCode,
      cardType: "C",
      cardCode: { notIn: clientCardCodes },
    },
    select: { cardCode: true },
  });
  if (peers.length === 0) {
    return NextResponse.json({
      ok: true,
      reason: "no-peers",
      sapGroupCode: client.sapGroupCode,
      sapGroupName: client.sapGroupName,
      families: [],
      groupSize: 0,
    });
  }
  const peerCodes = peers.map((p) => p.cardCode);

  // Top familles effectives du client sur N-1, par poids cumulé (kg).
  const clientFamilies = await prisma.$queryRaw<FamilyRow[]>(Prisma.sql`
    WITH fam AS (${FAMILY_CTE_SQL})
    SELECT
      fam."familyKey"                                                  AS "familyKey",
      MAX(fam."familyLabel")                                           AS "familyLabel",
      SUM(l."quantity" * COALESCE(fam."salesUnitWeight", 0))::float    AS "kg"
    FROM "SapInvoiceLine" AS l
    JOIN "SapInvoice"     AS i  ON i."docEntry" = l."docEntry"
    JOIN fam                    ON fam."itemCode" = l."itemCode"
    WHERE i."cardCode" IN (${Prisma.join(clientCardCodes)})
      AND i."docDate" BETWEEN ${periodStart} AND ${periodEnd}
      AND i."cancelled" = false
      AND l."isService" = false
    GROUP BY fam."familyKey"
    HAVING SUM(l."quantity" * COALESCE(fam."salesUnitWeight", 0)) > 0
    ORDER BY SUM(l."quantity" * COALESCE(fam."salesUnitWeight", 0)) DESC
    LIMIT ${TOP_N};
  `);

  if (clientFamilies.length === 0) {
    return NextResponse.json({
      ok: true,
      reason: "no-data",
      sapGroupCode: client.sapGroupCode,
      sapGroupName: client.sapGroupName,
      groupSize: peerCodes.length,
      families: [],
    });
  }

  const familyKeys = clientFamilies.map((f) => f.familyKey);

  const peerLines = await prisma.$queryRaw<PeerRow[]>(Prisma.sql`
    WITH fam AS (${FAMILY_CTE_SQL})
    SELECT
      i."cardCode"                                                     AS "cardCode",
      fam."familyKey"                                                  AS "familyKey",
      SUM(l."quantity" * COALESCE(fam."salesUnitWeight", 0))::float    AS "kg"
    FROM "SapInvoiceLine" AS l
    JOIN "SapInvoice"     AS i  ON i."docEntry" = l."docEntry"
    JOIN fam                    ON fam."itemCode" = l."itemCode"
    WHERE i."cardCode" IN (${Prisma.join(peerCodes)})
      AND i."docDate" BETWEEN ${periodStart} AND ${periodEnd}
      AND i."cancelled" = false
      AND l."isService" = false
      AND fam."familyKey" IN (${Prisma.join(familyKeys)})
    GROUP BY i."cardCode", fam."familyKey"
    HAVING SUM(l."quantity" * COALESCE(fam."salesUnitWeight", 0)) > 0;
  `);

  const byFamily = new Map<string, number[]>();
  for (const r of peerLines) {
    const arr = byFamily.get(r.familyKey) ?? [];
    arr.push(r.kg);
    byFamily.set(r.familyKey, arr);
  }

  const families = clientFamilies.map((f) => {
    const peerKgs = byFamily.get(f.familyKey) ?? [];
    const groupMedianKg = median(peerKgs);
    let direction: "up" | "down" | "neutral";
    let ratio: number | null;
    if (groupMedianKg <= 0) {
      ratio = null;
      direction = f.kg > 0 ? "up" : "neutral";
    } else {
      ratio = f.kg / groupMedianKg;
      if (ratio > 1 + DEAD_BAND) direction = "up";
      else if (ratio < 1 - DEAD_BAND) direction = "down";
      else direction = "neutral";
    }
    return {
      familyKey: f.familyKey,
      familyLabel: f.familyLabel ?? f.familyKey,
      clientKg: f.kg,
      groupMedianKg,
      peerCount: peerKgs.length,
      ratio,
      direction,
    };
  });

  return NextResponse.json({
    ok: true,
    sapGroupCode: client.sapGroupCode,
    sapGroupName: client.sapGroupName,
    groupSize: peerCodes.length,
    period: { year: yearMinus1 },
    families,
  });
}
