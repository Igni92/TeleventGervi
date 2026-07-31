import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { ADMIN_EMAILS, requireAdmin, requireStrictAdmin } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { parisStartOfDay } from "@/lib/paris-time";
import { writeAudit } from "@/lib/audit";

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

  let body: { userId?: string; present?: boolean; stockSharePct?: number; isAdmin?: boolean; isPreparateur?: boolean; isCommercial?: boolean; isDirection?: boolean; isLivreur?: boolean; isAgreeur?: boolean };
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
  // #30 — Octroyer/retirer `isDirection` confère (ou retire) un ACCÈS GLOBAL
  // (la direction voit tout comme un admin). C'est une élévation de privilège :
  // réservée à l'ADMIN STRICT (la direction ne peut pas se coopter elle-même).
  if (typeof body.isDirection === "boolean") {
    if (!strictAdmin) return NextResponse.json({ error: "Seul un administrateur peut modifier le rôle direction" }, { status: 403 });
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
  // Rôle livreur (accès restreint livraison + fiche client logistique). Raw SQL.
  if (typeof body.isLivreur === "boolean") {
    await prisma.$executeRawUnsafe(`UPDATE "User" SET "isLivreur" = $1 WHERE "id" = $2`, body.isLivreur, body.userId);
  }
  // Rôle agréeur (passe une commande fournisseur en entrée marchandise, sans
  // pouvoir créer ni l'une ni l'autre). Raw SQL, même convention.
  if (typeof body.isAgreeur === "boolean") {
    await prisma.$executeRawUnsafe(`UPDATE "User" SET "isAgreeur" = $1 WHERE "id" = $2`, body.isAgreeur, body.userId);
  }

  // #8/#30 — trace les modifications de rôle (l'octroi de isAdmin/isDirection est
  // une élévation de privilège : on garde une preuve de qui l'a fait et quand).
  const roleChanges: Record<string, boolean> = {};
  for (const r of ["isAdmin", "isDirection", "isPreparateur", "isCommercial", "isLivreur", "isAgreeur"] as const) {
    if (typeof body[r] === "boolean") roleChanges[r] = body[r] as boolean;
  }
  if (Object.keys(roleChanges).length > 0) {
    await writeAudit({ session, action: "ROLE_GRANT", entity: "User", entityId: body.userId, summary: "Modification de rôle(s)", details: roleChanges });
  }

  return NextResponse.json({ ok: true });
}

/**
 * DELETE /api/commerciaux  { userId }
 *
 * SUPPRIME un compte de l'équipe. Irréversible : Account, Session et Presence
 * partent en cascade (le salarié est déconnecté et devra se reconnecter, ce qui
 * recréera un compte VIERGE — donc sans rôle, bloqué sur /bienvenue).
 *
 * GARDE-FOUS — une suppression de compte est une action à sens unique :
 *   • ADMIN STRICT seulement : la direction gère les rôles, pas les comptes ;
 *   • jamais un email ADMIN_EMAILS (bootstrap) → anti-lock-out ;
 *   • jamais SOI-MÊME → on ne se retire pas ses propres accès par mégarde.
 *
 * Ce qui est délibérément CONSERVÉ : l'historique métier rattaché par email ou
 * par trigramme (heures, salaires, commissions, journaux d'audit) ne vit pas
 * dans la table User. Supprimer le compte retire l'ACCÈS, pas les traces —
 * c'est ce qu'on veut pour la paie et la traçabilité.
 */
export async function DELETE(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  if (!(await requireStrictAdmin(session))) {
    return NextResponse.json({ error: "Seul un administrateur peut supprimer un compte" }, { status: 403 });
  }

  let body: { userId?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "JSON invalide" }, { status: 400 }); }
  if (!body.userId) return NextResponse.json({ error: "userId requis" }, { status: 400 });

  const target = await prisma.user.findUnique({
    where: { id: body.userId },
    select: { id: true, name: true, email: true },
  });
  if (!target) return NextResponse.json({ error: "Compte introuvable" }, { status: 404 });

  const email = (target.email ?? "").toLowerCase();
  if (ADMIN_EMAILS.some((a) => a.toLowerCase() === email)) {
    return NextResponse.json({ error: "Ce compte administrateur ne peut pas être supprimé." }, { status: 400 });
  }
  if (target.id === session.user.id) {
    return NextResponse.json({ error: "Vous ne pouvez pas supprimer votre propre compte." }, { status: 400 });
  }

  // Trace AVANT la suppression : après, il ne reste plus rien à nommer.
  await writeAudit({
    session, action: "USER_DELETE", entity: "User", entityId: target.id,
    summary: `Suppression du compte ${target.name ?? target.email ?? target.id}`,
    details: { email: target.email },
  });

  // Le rattachement commercial vit hors du client Prisma typé : sans ce ménage,
  // un compte recréé au même email retrouverait son périmètre — et donc un accès
  // que personne ne lui aurait réattribué.
  try {
    await prisma.$executeRawUnsafe(`DELETE FROM "UserCommercial" WHERE LOWER("email") = LOWER($1)`, target.email ?? "");
  } catch { /* table absente → rien à nettoyer */ }

  await prisma.user.delete({ where: { id: target.id } });
  return NextResponse.json({ ok: true, deleted: target.name ?? target.email });
}
