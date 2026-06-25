import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { requireAdmin, requireStrictAdmin } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { parisStartOfDay } from "@/lib/paris-time";

// Début du jour en heure de Paris — cohérent avec /api/console et
// /api/temp-assignments (qui lisent/écrivent ces Presence sur la même borne).
function todayStart() { return parisStartOfDay(); }

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
  // Gestion d'équipe (présence + % stock + rôles) → admins OU direction.
  if (!(await requireAdmin(session))) return NextResponse.json({ error: "Réservé à l'administration / direction" }, { status: 403 });
  // Le rôle ADMIN ne peut être modifié QUE par un admin strict (pas la direction).
  const strictAdmin = await requireStrictAdmin(session);

  let body: { userId?: string; present?: boolean; stockSharePct?: number; isAdmin?: boolean; isPreparateur?: boolean; isCommercial?: boolean; isDirection?: boolean };
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
  // Rôle admin (promotion / rétrogradation) — ADMIN STRICT uniquement.
  if (typeof body.isAdmin === "boolean") {
    if (!strictAdmin) return NextResponse.json({ error: "Seul un administrateur peut modifier le rôle admin" }, { status: 403 });
    await prisma.$executeRawUnsafe(`UPDATE "User" SET "isAdmin" = $1 WHERE "id" = $2`, body.isAdmin, body.userId);
  }
  // Rôle direction — peut tout gérer SAUF le rôle admin et la base SAP. Raw SQL.
  if (typeof body.isDirection === "boolean") {
    await prisma.$executeRawUnsafe(`UPDATE "User" SET "isDirection" = $1 WHERE "id" = $2`, body.isDirection, body.userId);
  }
  // Rôle préparateur (« personne en charge du stock ») — droit de valider /
  // rouvrir / corriger les inventaires. Raw SQL, même convention que isAdmin.
  if (typeof body.isPreparateur === "boolean") {
    await prisma.$executeRawUnsafe(`UPDATE "User" SET "isPreparateur" = $1 WHERE "id" = $2`, body.isPreparateur, body.userId);
  }
  // Rôle commercial (force de vente) — indépendant des autres rôles. Raw SQL,
  // même convention (cf. scripts/ddl-user-roles.mjs).
  if (typeof body.isCommercial === "boolean") {
    await prisma.$executeRawUnsafe(`UPDATE "User" SET "isCommercial" = $1 WHERE "id" = $2`, body.isCommercial, body.userId);
  }

  return NextResponse.json({ ok: true });
}
