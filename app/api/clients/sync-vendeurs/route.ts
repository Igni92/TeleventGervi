import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { isAdmin } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";

/**
 * POST /api/clients/sync-vendeurs
 *
 * Déduit le VENDEUR de chaque client = commercial du **dernier BL** (SapOrder
 * le plus récent, non annulé) pour ce client. Ne touche pas au `commercial`
 * assigné (account manager). Override manuel possible via /api/clients/[id]/assign.
 *
 * Raw SQL — DISTINCT ON pour prendre la dernière commande par cardCode.
 */
export async function POST() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  // Réécrit le vendeur de TOUS les clients (mutation de masse) → admins uniquement.
  if (!isAdmin(session)) return NextResponse.json({ error: "Réservé aux administrateurs" }, { status: 403 });

  const updated = await prisma.$executeRaw`
    UPDATE "Client" AS c
    SET "vendeur" = sub."slp", "updatedAt" = NOW()
    FROM (
      SELECT DISTINCT ON (o."cardCode") o."cardCode", o."slpName" AS "slp"
      FROM "SapOrder" o
      WHERE o."cancelled" = false AND o."slpName" IS NOT NULL
      ORDER BY o."cardCode", o."docDate" DESC
    ) sub
    WHERE sub."cardCode" = c."code"
      AND c."type" IS DISTINCT FROM 'GMS'   -- GMS gardés sur leur vendeur par défaut (MM)
      AND sub."slp" IS DISTINCT FROM c."vendeur";
  `;

  return NextResponse.json({ ok: true, updated });
}
