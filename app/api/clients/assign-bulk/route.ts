import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { auth } from "@/lib/auth";
import { requireAdmin } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";

/**
 * POST /api/clients/assign-bulk
 *   body { ids: string[], vendeur?: string|null, commercial?: string|null, activeTelevente?: boolean }
 *
 * Assignation en série : applique vendeur / commercial / activation à tous les
 * clients cochés en un seul UPDATE. Raw SQL (champs hors client Prisma typé).
 */
const clean = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  // (Ré)assignation de portefeuille (vendeur/commercial/activation) → admins uniquement.
  if (!(await requireAdmin(session))) return NextResponse.json({ error: "Réservé aux administrateurs" }, { status: 403 });

  const body = await req.json().catch(() => ({}));
  const ids: string[] = Array.isArray(body.ids) ? body.ids.filter((x: unknown) => typeof x === "string") : [];
  if (ids.length === 0) return NextResponse.json({ error: "ids requis" }, { status: 400 });

  const sets: Prisma.Sql[] = [];
  if (body.vendeur !== undefined) sets.push(Prisma.sql`"vendeur" = ${clean(body.vendeur)}`);
  if (body.commercial !== undefined) sets.push(Prisma.sql`"commercial" = ${clean(body.commercial)}`);
  if (typeof body.activeTelevente === "boolean") sets.push(Prisma.sql`"activeTelevente" = ${body.activeTelevente}`);
  if (sets.length === 0) {
    return NextResponse.json({ error: "vendeur, commercial ou activeTelevente requis" }, { status: 400 });
  }

  const updated = await prisma.$executeRaw(
    Prisma.sql`UPDATE "Client" SET ${Prisma.join(sets, ", ")}, "updatedAt" = NOW() WHERE "id" IN (${Prisma.join(ids)})`,
  );
  return NextResponse.json({ ok: true, updated });
}
