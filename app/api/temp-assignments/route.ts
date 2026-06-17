import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getAccessScope } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { parisStartOfDay } from "@/lib/paris-time";

/**
 * Temporary daily assignments — pick up another commercial's clients for the day.
 *
 *   GET    /api/temp-assignments         → list my claims for today
 *   POST   /api/temp-assignments         → claim { commercial, type? }
 *   DELETE /api/temp-assignments?id=...  → release a single assignment
 *
 * The claim is scoped to "today" (00:00 → 23:59 local). After midnight, the
 * original commercial assignment naturally takes over again.
 */

// Début du jour en heure de Paris (cohérent avec /api/console & /api/commerciaux
// qui lisent/écrivent Presence & TempAssignment sur la même borne).
function dayStart(d = new Date()): Date {
  return parisStartOfDay(d);
}

/**
 * Le commercial d'origine (trigramme `slpName`) est-il marqué ABSENT aujourd'hui ?
 *
 * Chaîne de résolution : trigramme → email(s) via `UserCommercial` (1 trigramme
 * peut couvrir plusieurs comptes) → `User.id` → `Presence{date=today,present=false}`.
 * Robuste aux casses : tout est comparé en lower. Si la résolution échoue
 * (trigramme non mappé, table absente…), on retombe sur une règle de SÛRETÉ :
 * exiger qu'AU MOINS un commercial soit absent aujourd'hui (sinon refus).
 */
async function originalCommercialAbsentToday(trigram: string): Promise<boolean> {
  const today = dayStart();
  try {
    // Comptes (emails) rattachés à ce trigramme.
    const mapped = await prisma.$queryRawUnsafe<{ email: string }[]>(
      `SELECT "email" FROM "UserCommercial" WHERE LOWER("slpName") = LOWER($1)`,
      trigram,
    );
    const emails = mapped.map((m) => m.email.trim().toLowerCase()).filter(Boolean);
    if (emails.length > 0) {
      const users = await prisma.user.findMany({
        where: { email: { in: emails, mode: "insensitive" } },
        select: { id: true },
      });
      const userIds = users.map((u) => u.id);
      if (userIds.length > 0) {
        const absent = await prisma.presence.count({
          where: { userId: { in: userIds }, date: today, present: false },
        });
        return absent > 0;
      }
    }
  } catch {
    /* résolution indisponible → repli de sûreté ci-dessous */
  }
  // Repli : pas de mapping fiable trigramme→user → on n'autorise la reprise que
  // s'il existe AU MOINS une absence déclarée aujourd'hui (jamais ouvert sinon).
  try {
    const anyAbsent = await prisma.presence.count({ where: { date: today, present: false } });
    return anyAbsent > 0;
  } catch {
    return false;
  }
}

export async function GET() {
  const session = await auth();
  if (!session?.user?.id)
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

  const today = dayStart();
  const items = await prisma.tempAssignment.findMany({
    where: { userId: session.user.id, date: today },
    include: {
      client: {
        select: { id: true, code: true, nom: true, type: true, commercial: true },
      },
    },
    orderBy: { createdAt: "desc" },
  });
  return NextResponse.json({ items, date: today });
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id)
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

  const body = await req.json();
  const fromCommercial: string | undefined = body.commercial;
  const type: string | undefined = body.type; // "ALL" | "CHR" | "GMS" | "EXPORT"

  if (!fromCommercial) {
    return NextResponse.json({ error: "Commercial manquant" }, { status: 400 });
  }

  // Reprise réservée aux clients d'un collègue ABSENT aujourd'hui.
  // Admin (scope global) toujours autorisé. Sinon : le commercial d'origine
  // (trigramme `fromCommercial`) doit avoir une Presence present=false ce jour.
  const scope = await getAccessScope(session);
  if (!scope.all && !(await originalCommercialAbsentToday(fromCommercial))) {
    return NextResponse.json(
      { error: "Reprise possible uniquement si le commercial est absent aujourd'hui" },
      { status: 403 },
    );
  }

  // Build the where clause for matching clients
  const where: Record<string, unknown> = { commercial: fromCommercial };
  if (type && type !== "ALL") {
    where.type = type;
  }

  // Fetch matching clients
  const clients = await prisma.client.findMany({
    where,
    select: { id: true },
  });
  if (clients.length === 0) {
    return NextResponse.json({ created: 0, skipped: 0 });
  }

  // Insert temp assignments — upsert per (clientId, date)
  const today = dayStart();
  let created = 0, skipped = 0;
  for (const c of clients) {
    try {
      await prisma.tempAssignment.create({
        data: {
          clientId: c.id,
          userId: session.user.id,
          fromCommercial,
          date: today,
        },
      });
      created++;
    } catch {
      // Unique constraint hit — already claimed (by someone, possibly self)
      skipped++;
    }
  }

  return NextResponse.json({ created, skipped, total: clients.length });
}

export async function DELETE(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id)
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id");
  const releaseAll = searchParams.get("all") === "true";

  if (releaseAll) {
    // Release everything I claimed today
    const result = await prisma.tempAssignment.deleteMany({
      where: { userId: session.user.id, date: dayStart() },
    });
    return NextResponse.json({ released: result.count });
  }

  if (!id) return NextResponse.json({ error: "id manquant" }, { status: 400 });

  // Only allow deleting one's own assignments
  const existing = await prisma.tempAssignment.findUnique({ where: { id } });
  if (!existing || existing.userId !== session.user.id) {
    return NextResponse.json({ error: "Non autorisé" }, { status: 403 });
  }
  await prisma.tempAssignment.delete({ where: { id } });
  return NextResponse.json({ released: 1 });
}
