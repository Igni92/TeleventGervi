import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

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

function dayStart(d = new Date()): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
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
