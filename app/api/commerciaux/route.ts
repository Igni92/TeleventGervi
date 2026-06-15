import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { requireAdmin } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";

function todayStart() { const d = new Date(); d.setHours(0, 0, 0, 0); return d; }

/**
 * GET /api/commerciaux
 * → liste des commerciaux (users) avec leur % de stock attribué et leur présence du jour.
 */
export async function GET() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

  const users = await prisma.user.findMany({
    select: { id: true, name: true, email: true, stockSharePct: true },
    orderBy: { name: "asc" },
  });
  const presences = await prisma.presence.findMany({ where: { date: todayStart() } });
  const presMap = new Map(presences.map((p) => [p.userId, p.present]));

  return NextResponse.json({
    commerciaux: users.map((u) => ({
      id: u.id, name: u.name, email: u.email,
      stockSharePct: u.stockSharePct ?? 100,
      present: presMap.get(u.id) ?? true,        // présent par défaut
    })),
  });
}

/**
 * PATCH /api/commerciaux
 * Body: { userId, present?: boolean, stockSharePct?: number }
 * Met à jour la présence du jour et/ou le % de stock attribué.
 */
export async function PATCH(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  // Gestion d'équipe (présence + % stock de N'IMPORTE quel commercial) → admins uniquement.
  if (!(await requireAdmin(session))) return NextResponse.json({ error: "Réservé aux administrateurs" }, { status: 403 });

  let body: { userId?: string; present?: boolean; stockSharePct?: number; isAdmin?: boolean };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "JSON invalide" }, { status: 400 }); }
  if (!body.userId) return NextResponse.json({ error: "userId requis" }, { status: 400 });

  // Présence du jour (upsert)
  if (typeof body.present === "boolean") {
    const date = todayStart();
    await prisma.presence.upsert({
      where: { userId_date: { userId: body.userId, date } },
      create: { userId: body.userId, date, present: body.present },
      update: { present: body.present },
    });
  }
  // % de stock attribué
  if (typeof body.stockSharePct === "number") {
    const pct = Math.max(0, Math.min(100, body.stockSharePct));
    await prisma.user.update({ where: { id: body.userId }, data: { stockSharePct: pct } });
  }
  // Rôle admin (promotion / rétrogradation). Raw SQL : colonne hors client Prisma
  // typé tant que generate n'est pas relancé (cf. scripts/ddl-user-isadmin.mjs).
  if (typeof body.isAdmin === "boolean") {
    await prisma.$executeRawUnsafe(`UPDATE "User" SET "isAdmin" = $1 WHERE "id" = $2`, body.isAdmin, body.userId);
  }

  return NextResponse.json({ ok: true });
}
