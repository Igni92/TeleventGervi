import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { requireAdmin } from "@/lib/permissions";
import { isRhV2Enabled } from "@/lib/rh/flag";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

/**
 * GET /api/rh/analytics — TURNOVER & ANALYTICS RH (direction). Effectif, entrées/
 * sorties sur 12 mois, taux de turnover, ancienneté moyenne, répartition contrats,
 * absentéisme (jours de congés approuvés). Sur Employee / Contract / RhEvent /
 * RhLeaveRequest.
 */
export async function GET() {
  if (!isRhV2Enabled()) return NextResponse.json({ error: "Module RH V2 désactivé" }, { status: 404 });
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  if (!(await requireAdmin(session))) return NextResponse.json({ error: "Réservé à la direction" }, { status: 403 });

  const now = new Date();
  const from = new Date(now.getFullYear(), now.getMonth() - 11, 1); // 12 mois glissants

  const [employees, activeContracts, hires, departs, leaves] = await Promise.all([
    prisma.employee.findMany({ select: { id: true, statutEmploi: true, hireDate: true, exitDate: true } }),
    prisma.contract.findMany({ where: { statut: "actif" }, select: { type: true, employeeId: true } }),
    prisma.rhEvent.findMany({ where: { type: "embauche", date: { gte: from } }, select: { date: true } }),
    prisma.rhEvent.findMany({ where: { type: "depart", date: { gte: from } }, select: { date: true } }),
    prisma.rhLeaveRequest.findMany({ where: { statut: "approved", startDate: { gte: from } }, select: { jours: true, type: true } }),
  ]);

  const actifs = employees.filter((e) => e.statutEmploi === "actif");
  const sortis = employees.filter((e) => e.statutEmploi === "sorti");

  // Série mensuelle entrées/sorties (12 mois).
  const monthKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  const months: { key: string; label: string; entrees: number; sorties: number }[] = [];
  for (let i = 11; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    months.push({ key: monthKey(d), label: d.toLocaleDateString("fr-FR", { month: "short" }), entrees: 0, sorties: 0 });
  }
  const idx = new Map(months.map((m, i) => [m.key, i]));
  for (const h of hires) { const i = idx.get(monthKey(h.date)); if (i != null) months[i].entrees++; }
  for (const d of departs) { const i = idx.get(monthKey(d.date)); if (i != null) months[i].sorties++; }

  const nbEntrees = hires.length;
  const nbSorties = departs.length;
  const effectifMoyen = Math.max(1, (actifs.length + (actifs.length + nbSorties - nbEntrees)) / 2);
  const turnoverPct = Math.round((nbSorties / effectifMoyen) * 1000) / 10;

  // Ancienneté moyenne (années) sur les actifs qui ont une date d'entrée — HORS
  // administrateur/mandataire (présent depuis la création, fausserait la moyenne salariés).
  const adminIds = new Set(activeContracts.filter((c) => c.type === "ADMINISTRATEUR").map((c) => c.employeeId));
  const withHire = actifs.filter((e) => e.hireDate && !adminIds.has(e.id));
  const ancienneteMoy = withHire.length
    ? Math.round((withHire.reduce((s, e) => s + (now.getTime() - new Date(e.hireDate!).getTime()), 0) / withHire.length / (365.25 * 86400_000)) * 10) / 10
    : null;

  // Répartition contrats actifs.
  const mix: Record<string, number> = {};
  for (const c of activeContracts) mix[c.type] = (mix[c.type] ?? 0) + 1;

  const absenceJours = Math.round(leaves.reduce((s, l) => s + l.jours, 0) * 10) / 10;

  return NextResponse.json({
    ok: true,
    stats: {
      effectif: actifs.length, sortis: sortis.length,
      entrees12m: nbEntrees, sorties12m: nbSorties, turnoverPct,
      ancienneteMoy, absenceJours,
    },
    months,
    contractMix: Object.entries(mix).map(([type, n]) => ({ type, n })).sort((a, b) => b.n - a.n),
  });
}
