import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { auth } from "@/lib/auth";
import { requireAdmin } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";

/**
 * POST /api/clients/[id]/assign
 *   body { activeTelevente?: boolean, vendeur?: string|null, commercial?: string|null }
 *
 * Active/désactive un client en TeleVente et/ou (ré)assigne son vendeur (télévente)
 * et/ou son commercial (account manager). Raw SQL : vendeur/activeTelevente ne
 * sont pas dans le client Prisma typé (generate bloqué).
 */
const clean = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  // (Ré)assignation de portefeuille (vendeur/commercial/activation) → admins uniquement.
  if (!(await requireAdmin(session))) return NextResponse.json({ error: "Réservé aux administrateurs" }, { status: 403 });

  const body = await req.json().catch(() => ({}));
  const sets: Prisma.Sql[] = [];
  if (typeof body.activeTelevente === "boolean") {
    sets.push(Prisma.sql`"activeTelevente" = ${body.activeTelevente}`);
  }
  if (body.vendeur !== undefined) {
    sets.push(Prisma.sql`"vendeur" = ${clean(body.vendeur)}`);
  }
  if (body.commercial !== undefined) {
    sets.push(Prisma.sql`"commercial" = ${clean(body.commercial)}`);
  }
  if (sets.length === 0) {
    return NextResponse.json({ error: "Rien à modifier (activeTelevente, vendeur ou commercial requis)" }, { status: 400 });
  }

  await prisma.$executeRaw(
    Prisma.sql`UPDATE "Client" SET ${Prisma.join(sets, ", ")}, "updatedAt" = NOW() WHERE "id" = ${params.id}`,
  );
  return NextResponse.json({ ok: true });
}
