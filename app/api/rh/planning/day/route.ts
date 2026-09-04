import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { requireAdmin } from "@/lib/permissions";
import { isRhV2Enabled } from "@/lib/rh/flag";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

const TAGS = ["present", "conges", "recup", "maladie", "absent", "ferie"];

/** POST /api/rh/planning/day — édition manuelle d'un jour de planning (direction).
 *  Body : { employeeId, isoWeek, dayIndex (0..6), min? (minutes), tag?, clear? }.
 *  Écrit dans RhWeekSheet.days (override lu par gatherTeamWeek). */
export async function POST(req: NextRequest) {
  if (!isRhV2Enabled()) return NextResponse.json({ error: "Module RH V2 désactivé" }, { status: 404 });
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  if (!(await requireAdmin(session))) return NextResponse.json({ error: "Réservé à la direction" }, { status: 403 });

  let b: Record<string, unknown>;
  try { b = await req.json(); } catch { return NextResponse.json({ error: "JSON invalide" }, { status: 400 }); }
  const employeeId = String(b.employeeId ?? "");
  const isoWeek = String(b.isoWeek ?? "");
  const dayIndex = Number(b.dayIndex);
  if (!employeeId || !/^\d{4}-W\d{2}$/.test(isoWeek) || !Number.isInteger(dayIndex) || dayIndex < 0 || dayIndex > 6) {
    return NextResponse.json({ error: "Paramètres invalides" }, { status: 400 });
  }
  const tag = typeof b.tag === "string" && TAGS.includes(b.tag) ? b.tag : undefined;
  const min = typeof b.min === "number" && Number.isFinite(b.min) ? Math.max(0, Math.round(b.min)) : undefined;
  const clear = b.clear === true;

  const sheet = await prisma.rhWeekSheet.findUnique({ where: { employeeId_isoWeek: { employeeId, isoWeek } }, select: { days: true } });
  let days: ({ min?: number; tag?: string } | null)[] = [];
  if (sheet?.days) { try { const a = JSON.parse(sheet.days); if (Array.isArray(a)) days = a; } catch { /* reset */ } }
  while (days.length < 7) days.push(null);

  days[dayIndex] = clear ? null : { ...(min !== undefined ? { min } : {}), ...(tag ? { tag } : {}) };

  await prisma.rhWeekSheet.upsert({
    where: { employeeId_isoWeek: { employeeId, isoWeek } },
    create: { employeeId, isoWeek, days: JSON.stringify(days), updatedBy: session.user.email ?? null },
    update: { days: JSON.stringify(days), updatedBy: session.user.email ?? null },
  });
  return NextResponse.json({ ok: true });
}
