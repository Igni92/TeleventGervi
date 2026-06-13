import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

/**
 * POST /api/notifications/seen — marque une promo comme consultée.
 *
 * Body { promoId } → upsert "PromoSeen" (userId, promoId) → { ok: true }.
 * Idempotent : re-marquer une promo déjà vue rafraîchit simplement seenAt.
 * 404 si la promo n'existe pas (évite une violation de FK).
 *
 * Le badge « NOUVEAU » du bandeau et isNew de GET /api/notifications
 * tombent dès que la ligne existe.
 *
 * ⚠️ Tables Promo / PromoSeen absentes du client Prisma généré
 *    → raw SQL paramétré exclusivement ($1, $2…).
 */

export const dynamic = "force-dynamic";

/** Identifiant utilisateur : id de session, fallback email (convention des autres routes). */
function userIdFrom(session: { user?: { id?: string | null; email?: string | null } } | null) {
  return session?.user?.id ?? session?.user?.email ?? null;
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  const userId = userIdFrom(session);
  if (!userId) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const promoId = typeof body?.promoId === "string" ? body.promoId.trim() : "";
  if (!promoId) return NextResponse.json({ error: "promoId manquant" }, { status: 400 });

  const exists = await prisma.$queryRawUnsafe<{ id: string }[]>(
    `SELECT "id" FROM "Promo" WHERE "id" = $1;`,
    promoId,
  );
  if (exists.length === 0) {
    return NextResponse.json({ error: "Promo introuvable" }, { status: 404 });
  }

  await prisma.$executeRawUnsafe(
    `INSERT INTO "PromoSeen" ("userId", "promoId", "seenAt")
     VALUES ($1, $2, NOW())
     ON CONFLICT ("userId", "promoId") DO UPDATE SET "seenAt" = NOW();`,
    userId, promoId,
  );

  return NextResponse.json({ ok: true });
}
