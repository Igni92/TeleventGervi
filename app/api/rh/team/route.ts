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

  const [employees, clocks, contracts, pendingLeaves] = await Promise.all([
    // Registre COMPLET : actifs + sortis (le registre liste tout le monde).
    prisma.employee.findMany({
      select: { id: true, email: true, displayName: true, poste: true, service: true, hireDate: true, sapSlpName: true, statutEmploi: true },
      orderBy: [{ statutEmploi: "asc" }, { displayName: "asc" }, { email: "asc" }],
    }),
    prisma.rhTimeClock.findMany({ where: { date: today }, include: { punches: { orderBy: { at: "asc" } } } }),
    prisma.contract.findMany({ orderBy: { dateDebut: "desc" }, select: { employeeId: true, type: true, heuresHebdo: true, statut: true, dateDebut: true, dateFin: true, essaiFin: true, saisonLabel: true } }),
    prisma.rhLeaveRequest.count({ where: { statut: "pending" } }),
  ]);

  const clockByEmp = new Map(clocks.map((c) => [c.employeeId, c]));
  // Contrat de référence par salarié = actif sinon le plus récent.
  const contractByEmp = new Map<string, typeof contracts[number]>();
  for (const c of contracts) {
    const cur = contractByEmp.get(c.employeeId);
    if (!cur || (c.statut === "actif" && cur.statut !== "actif")) contractByEmp.set(c.employeeId, c);
  }

  let presentCount = 0; let effectif = 0;
  const team = employees.map((e) => {
    const actif = e.statutEmploi === "actif";
    if (actif) effectif++;
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
      id: e.id, name: e.displayName ?? e.email, email: e.email, poste: e.poste, service: e.service, sap: e.sapSlpName,
      statutEmploi: e.statutEmploi, hireDate: e.hireDate,
      contractType: ct?.type ?? null, heuresHebdo: ct?.heuresHebdo ?? null, contractStatut: ct?.statut ?? null,
      dateDebut: ct?.dateDebut ?? null, dateFin: ct?.dateFin ?? null, essaiFin: ct?.essaiFin ?? null, saisonLabel: ct?.saisonLabel ?? null,
      inside, hasClocked, workedMin,
    };
  });

  // Alertes : fin d'essai OU fin de CDD/saisonnier dans les 30 jours (contrats actifs).
  const alerts = contracts
    .filter((c) => c.statut === "actif" && ((c.essaiFin && c.essaiFin >= today && c.essaiFin <= in30) || (c.dateFin && c.dateFin >= today && c.dateFin <= in30)))
    .map((c) => {
      const emp = employees.find((e) => e.id === c.employeeId);
      const essai = c.essaiFin && c.essaiFin >= today && c.essaiFin <= in30;
      return { name: emp?.displayName ?? emp?.email ?? "?", kind: essai ? "essai" : "cdd", date: essai ? c.essaiFin : c.dateFin, contractType: c.type };
    })
    .filter((a) => a.date).sort((x, y) => new Date(x.date!).getTime() - new Date(y.date!).getTime());

  const CONTRACT_TYPES = ["CDI", "CDD", "SAISONNIER", "APPRENTISSAGE", "INTERIM", "STAGE", "ADMINISTRATEUR"];

  return NextResponse.json({
    ok: true,
    stats: { effectif, presents: presentCount, congesEnAttente: pendingLeaves, alertes: alerts.length },
    team,
    alerts,
    types: CONTRACT_TYPES,
  });
}
