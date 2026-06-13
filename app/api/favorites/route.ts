import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

/**
 * /api/favorites — favoris articles ET groupes famille de l'utilisateur connecté.
 *
 * GET    → { itemCodes: string[], groups: string[] } triés par position ASC
 *          puis createdAt ASC (chaque liste indépendamment).
 * POST   { itemCode } OU { group } → upsert (ON CONFLICT DO NOTHING),
 *        position = COALESCE(MAX(position)+1, 0) pour cet utilisateur → { ok: true }.
 * DELETE ?itemCode=X OU ?group=Y → suppression idempotente → { ok: true }.
 *
 * ⚠️ Tables FavoriteItem / FavoriteGroup absentes du client Prisma généré
 * (régénération impossible — EPERM dev server) → accès exclusivement en
 * raw SQL paramétré ($1, $2…). DDL : scripts/ddl-favorite-groups.mjs.
 */

export const dynamic = "force-dynamic";

/** Identifiant utilisateur : id de session, fallback email (convention des autres routes). */
function userIdFrom(session: { user?: { id?: string | null; email?: string | null } } | null) {
  return session?.user?.id ?? session?.user?.email ?? null;
}

export async function GET() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  const userId = userIdFrom(session);
  if (!userId) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

  const rows = await prisma.$queryRawUnsafe<{ itemCode: string }[]>(
    `SELECT "itemCode"
     FROM "FavoriteItem"
     WHERE "userId" = $1
     ORDER BY "position" ASC, "createdAt" ASC;`,
    userId,
  );

  // Groupes favoris — défensif : si la table n'existe pas encore (DDL non passé),
  // on renvoie une liste vide plutôt qu'une 500 (les favoris articles restent servis).
  let groups: string[] = [];
  try {
    const grows = await prisma.$queryRawUnsafe<{ groupName: string }[]>(
      `SELECT "groupName"
       FROM "FavoriteGroup"
       WHERE "userId" = $1
       ORDER BY "position" ASC, "createdAt" ASC;`,
      userId,
    );
    groups = grows.map((g) => g.groupName);
  } catch {
    /* table absente — exécuter scripts/ddl-favorite-groups.mjs */
  }

  return NextResponse.json({ itemCodes: rows.map((r) => r.itemCode), groups });
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  const userId = userIdFrom(session);
  if (!userId) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const itemCode = typeof body?.itemCode === "string" ? body.itemCode.trim() : "";
  const group = typeof body?.group === "string" ? body.group.trim() : "";
  if (!itemCode && !group) {
    return NextResponse.json({ error: "itemCode ou group manquant" }, { status: 400 });
  }

  if (itemCode) {
    // Upsert idempotent — position en fin de liste pour cet utilisateur.
    await prisma.$executeRawUnsafe(
      `INSERT INTO "FavoriteItem" ("id", "userId", "itemCode", "position", "createdAt")
       VALUES (
         gen_random_uuid()::text, $1, $2,
         COALESCE((SELECT MAX("position") + 1 FROM "FavoriteItem" WHERE "userId" = $1), 0),
         NOW()
       )
       ON CONFLICT ("userId", "itemCode") DO NOTHING;`,
      userId, itemCode,
    );
  } else {
    await prisma.$executeRawUnsafe(
      `INSERT INTO "FavoriteGroup" ("id", "userId", "groupName", "position", "createdAt")
       VALUES (
         gen_random_uuid()::text, $1, $2,
         COALESCE((SELECT MAX("position") + 1 FROM "FavoriteGroup" WHERE "userId" = $1), 0),
         NOW()
       )
       ON CONFLICT ("userId", "groupName") DO NOTHING;`,
      userId, group,
    );
  }

  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  const userId = userIdFrom(session);
  if (!userId) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

  const itemCode = req.nextUrl.searchParams.get("itemCode")?.trim();
  const group = req.nextUrl.searchParams.get("group")?.trim();
  if (!itemCode && !group) {
    return NextResponse.json({ error: "itemCode ou group manquant" }, { status: 400 });
  }

  // Idempotent : 200 même si le favori n'existait pas.
  if (itemCode) {
    await prisma.$executeRawUnsafe(
      `DELETE FROM "FavoriteItem" WHERE "userId" = $1 AND "itemCode" = $2;`,
      userId, itemCode,
    );
  } else {
    await prisma.$executeRawUnsafe(
      `DELETE FROM "FavoriteGroup" WHERE "userId" = $1 AND "groupName" = $2;`,
      userId, group!,
    );
  }

  return NextResponse.json({ ok: true });
}
