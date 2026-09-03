import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { requireAdmin } from "@/lib/permissions";
import { isRhV2Enabled } from "@/lib/rh/flag";
import { prisma } from "@/lib/prisma";
import { punchesToMinutes } from "@/lib/rh/time";

export const dynamic = "force-dynamic";

/**
 * GET /api/rh/team — COCKPIT DIRECTION (RH V2) : état de l'équipe.
 * Présence du jour (badgeuse), effectif, contrats à échéance (essai/CDD),
 * congés en attente. Réservé aux managers (admin/direction).
 */
export async function GET() {
  if (!isRhV2Enabled()) return NextResponse.json({ error: "Module RH V2 désactivé" }, { status: 404 });
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  if (!(await requireAdmin(session))) return NextResponse.json({ error: "Réservé à la direction" }, { status: 403 });

  const now = new Date();
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const in30 = new Date(now.getTime() + 30 * 86400_000);

  const [employees, clocks, contractsActive, alertsRaw, pendingLeaves] = await Promise.all([
    prisma.employee.findMany({
      where: { statutEmploi: "actif" },
      select: { id: true, email: true, displayName: true, poste: true, service: true, hireDate: true, sapSlpName: true },
      orderBy: [{ displayName: "asc" }, { email: "asc" }],
    }),
    prisma.rhTimeClock.findMany({ where: { date: today }, include: { punches: { orderBy: { at: "asc" } } } }),
    prisma.contract.findMany({ where: { statut: "actif" }, select: { employeeId: true, type: true, heuresHebdo: true } }),
    // Alertes : fin d'essai OU fin de CDD/saisonnier dans les 30 jours.
    prisma.contract.findMany({
      where: { statut: "actif", OR: [{ essaiFin: { gte: today, lte: in30 } }, { dateFin: { gte: today, lte: in30 } }] },
      select: { employeeId: true, type: true, essaiFin: true, dateFin: true },
    }),
    prisma.rhLeaveRequest.count({ where: { statut: "pending" } }),
  ]);

  const clockByEmp = new Map(clocks.map((c) => [c.employeeId, c]));
  const contractByEmp = new Map(contractsActive.map((c) => [c.employeeId, c]));

  let presentCount = 0;
  const team = employees.map((e) => {
    const c = clockByEmp.get(e.id);
    const punches = (c?.punches ?? []).map((p) => ({ kind: p.kind as "in" | "out", at: p.at }));
    const inside = punches[punches.length - 1]?.kind === "in";
    const closed = punchesToMinutes(punches, c?.pauseMin ?? 0);
    const openExtra = inside && punches.length ? Math.max(0, Math.round((now.getTime() - new Date(punches[punches.length - 1].at).getTime()) / 60000)) : 0;
    const workedMin = closed + openExtra;
    const hasClocked = punches.length > 0;
    if (inside) presentCount++;
    const ct = contractByEmp.get(e.id);
    return {
      id: e.id, name: e.displayName ?? e.email, poste: e.poste, service: e.service, sap: e.sapSlpName,
      contractType: ct?.type ?? null, heuresHebdo: ct?.heuresHebdo ?? null,
      hireDate: e.hireDate, inside, hasClocked, workedMin,
    };
  });

  const alerts = alertsRaw.map((a) => {
    const emp = employees.find((e) => e.id === a.employeeId);
    const essai = a.essaiFin && a.essaiFin >= today && a.essaiFin <= in30;
    return {
      name: emp?.displayName ?? emp?.email ?? "?",
      kind: essai ? "essai" : "cdd",
      date: essai ? a.essaiFin : a.dateFin,
      contractType: a.type,
    };
  }).filter((a) => a.date).sort((x, y) => new Date(x.date!).getTime() - new Date(y.date!).getTime());

  return NextResponse.json({
    ok: true,
    stats: { effectif: employees.length, presents: presentCount, congesEnAttente: pendingLeaves, alertes: alerts.length },
    team,
    alerts,
  });
}
