import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getAccessScope } from "@/lib/permissions";

/**
 * GET /api/sap/clients/[id]/credit
 *
 * Encours / limite de crédit du client, lus depuis le miroir local
 * SapBusinessPartner (champs SAP CreditLimit / CurrentAccountBalance / Frozen,
 * peuplés par lib/sapMirror.ts). Lecture seule — aucune écriture SAP.
 *
 * Scope : un commercial (non admin) ne voit que SES clients
 * (Client.commercial = slpName OU Client.vendeur = slpName), cf. lib/permissions.ts
 * et /api/clients. Hors scope → 403.
 *
 * Tolère :
 *   - colonnes credit absentes (migration non appliquée) → available:false
 *   - BP absent du miroir → available:false
 */
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

  const clientId = params.id;
  if (!clientId) return NextResponse.json({ error: "clientId requis" }, { status: 400 });

  const client = await prisma.client.findUnique({
    where: { id: clientId },
    select: { code: true },
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

  // Lecture du BP miroir (raw SQL — colonnes credit hors client Prisma typé tant
  // que generate n'a pas tourné, et tolérance si la migration n'est pas appliquée).
  try {
    const rows = await prisma.$queryRaw<{
      creditLimit: number | null;
      currentAccountBalance: number | null;
      frozen: boolean | null;
    }[]>(
      Prisma.sql`SELECT "creditLimit", "currentAccountBalance", "frozen"
                 FROM "SapBusinessPartner"
                 WHERE "cardCode" = ${client.code}
                 LIMIT 1`,
    );
    const bp = rows[0];
    const creditLimit = bp?.creditLimit ?? null;
    const balance = bp?.currentAccountBalance ?? null;
    const frozen = bp?.frozen ?? false;

    // available = on a au moins une des deux valeurs métier à montrer.
    const available = creditLimit != null || balance != null;
    if (!available) {
      return NextResponse.json({ available: false, frozen });
    }

    // % d'utilisation du plafond (null si pas de limite définie ou ≤ 0).
    const usagePct = creditLimit && creditLimit > 0 && balance != null
      ? Math.round((balance / creditLimit) * 1000) / 10
      : null;
    const overLimit = creditLimit != null && creditLimit > 0 && balance != null && balance > creditLimit;

    return NextResponse.json({
      available: true,
      creditLimit,
      balance,
      usagePct,
      overLimit,
      frozen,
    });
  } catch {
    // Colonnes absentes (migration non appliquée) ou table indisponible.
    return NextResponse.json({ available: false, frozen: false });
  }
}
