import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { isRhV2Enabled } from "@/lib/rh/flag";
import { getOrCreateEmployeeByEmail, getTodayClock } from "@/lib/rh/db";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

/**
 * GET /api/rh/me — état du salarié connecté pour l'espace perso (badgeuse) :
 * pointage du jour (dedans/dehors, minutes), contrat actif, soldes (CP/récup).
 */
export async function GET() {
  if (!isRhV2Enabled()) return NextResponse.json({ error: "Module RH V2 désactivé" }, { status: 404 });
  const session = await auth();
  const email = session?.user?.email;
  if (!email) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

  const emp = await getOrCreateEmployeeByEmail(email, session.user?.name);
  const [today, contract, balance, documents] = await Promise.all([
    getTodayClock(emp.id),
    prisma.contract.findFirst({ where: { employeeId: emp.id, statut: "actif" }, orderBy: { dateDebut: "desc" } }),
    prisma.rhLeaveBalance.findFirst({ where: { employeeId: emp.id }, orderBy: { updatedAt: "desc" } }),
    prisma.rhDocument.findMany({ where: { employeeId: emp.id, visibleSalarie: true }, select: { id: true, type: true, nom: true, createdAt: true }, orderBy: { createdAt: "desc" } }),
  ]);

  return NextResponse.json({
    ok: true,
    employee: { id: emp.id, email: emp.email, name: session.user?.name ?? null },
    today: {
      inside: today.inside,
      workedMin: today.workedMin,
      punches: today.punches.map((p) => ({ kind: p.kind, at: p.at })),
    },
    contract: contract ? { type: contract.type, heuresHebdo: contract.heuresHebdo, heuresAnnuelles: contract.heuresAnnuelles } : null,
    soldes: balance
      ? { cpSolde: balance.cpSolde, recupSoldeMin: balance.recupSoldeMin, recupCapMin: balance.recupCapMin }
      : { cpSolde: 0, recupSoldeMin: 0, recupCapMin: 0 },
    documents,
  });
}
