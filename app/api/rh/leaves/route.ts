import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { requireAdmin } from "@/lib/permissions";
import { isRhV2Enabled } from "@/lib/rh/flag";
import { getOrCreateEmployeeByEmail } from "@/lib/rh/db";
import { joursOuvrables, isLeaveType } from "@/lib/rh/leave";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

async function ctx() {
  if (!isRhV2Enabled()) return { err: NextResponse.json({ error: "Module RH V2 désactivé" }, { status: 404 }) };
  const session = await auth();
  const email = session?.user?.email;
  if (!email) return { err: NextResponse.json({ error: "Non autorisé" }, { status: 401 }) };
  const emp = await getOrCreateEmployeeByEmail(email, session.user?.name);
  const manager = await requireAdmin(session);
  return { emp, manager, email };
}

/** GET /api/rh/leaves — mes congés ; ?scope=team (manager) = file à valider + équipe. */
export async function GET(req: NextRequest) {
  const c = await ctx(); if (c.err) return c.err;
  const scope = new URL(req.url).searchParams.get("scope");
  if (scope === "team") {
    if (!c.manager) return NextResponse.json({ error: "Réservé à la direction" }, { status: 403 });
    const all = await prisma.rhLeaveRequest.findMany({
      orderBy: [{ statut: "asc" }, { startDate: "desc" }],
      include: { employee: { select: { displayName: true, email: true } } },
      take: 300,
    });
    return NextResponse.json({ ok: true, leaves: all.map((l) => ({ ...l, who: l.employee.displayName ?? l.employee.email })) });
  }
  const [mine, balance] = await Promise.all([
    prisma.rhLeaveRequest.findMany({ where: { employeeId: c.emp.id }, orderBy: { startDate: "desc" }, take: 100 }),
    prisma.rhLeaveBalance.findFirst({ where: { employeeId: c.emp.id }, orderBy: { updatedAt: "desc" } }),
  ]);
  return NextResponse.json({ ok: true, leaves: mine, balance, isManager: c.manager });
}

/**
 * POST /api/rh/leaves — actions :
 *  - { action:"request", type, startDate, endDate, note? } (salarié)
 *  - { action:"decide", id, decision:"approved"|"refused", decisionNote? } (manager)
 *  - { action:"cancel", id } (salarié, sur sa demande pending)
 */
export async function POST(req: NextRequest) {
  const c = await ctx(); if (c.err) return c.err;
  let b: Record<string, unknown>;
  try { b = await req.json(); } catch { return NextResponse.json({ error: "JSON invalide" }, { status: 400 }); }
  const action = String(b.action ?? "");

  if (action === "request") {
    if (!isLeaveType(b.type)) return NextResponse.json({ error: "type invalide" }, { status: 400 });
    const start = new Date(String(b.startDate)); const end = new Date(String(b.endDate));
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end < start) {
      return NextResponse.json({ error: "Dates invalides" }, { status: 400 });
    }
    const feries = new Set((await prisma.rhHoliday.findMany({ where: { date: { gte: start, lte: end } }, select: { date: true } }))
      .map((h) => h.date.toISOString().slice(0, 10)));
    const jours = joursOuvrables(start, end, feries);
    const created = await prisma.rhLeaveRequest.create({
      data: { employeeId: c.emp.id, type: b.type, statut: "pending", startDate: start, endDate: end, jours, origin: "salarie", note: b.note ? String(b.note) : null },
    });
    await prisma.rhEvent.create({ data: { employeeId: c.emp.id, type: "absence", date: start, meta: JSON.stringify({ leaveId: created.id, leaveType: b.type, jours }) } });
    return NextResponse.json({ ok: true, leave: created });
  }

  if (action === "decide") {
    if (!c.manager) return NextResponse.json({ error: "Réservé à la direction" }, { status: 403 });
    const id = String(b.id ?? "");
    const decision = b.decision === "approved" ? "approved" : b.decision === "refused" ? "refused" : null;
    if (!id || !decision) return NextResponse.json({ error: "id + decision requis" }, { status: 400 });
    const updated = await prisma.rhLeaveRequest.update({
      where: { id }, data: { statut: decision, decidedBy: c.email, decidedAt: new Date(), decisionNote: b.decisionNote ? String(b.decisionNote) : null },
    }).catch(() => null);
    if (!updated) return NextResponse.json({ error: "Demande introuvable" }, { status: 404 });
    return NextResponse.json({ ok: true, leave: updated });
  }

  if (action === "cancel") {
    const id = String(b.id ?? "");
    const leave = await prisma.rhLeaveRequest.findUnique({ where: { id }, select: { employeeId: true, statut: true } });
    if (!leave || leave.employeeId !== c.emp.id) return NextResponse.json({ error: "Non autorisé" }, { status: 403 });
    const updated = await prisma.rhLeaveRequest.update({ where: { id }, data: { statut: "cancelled" } });
    return NextResponse.json({ ok: true, leave: updated });
  }

  return NextResponse.json({ error: "action inconnue" }, { status: 400 });
}
