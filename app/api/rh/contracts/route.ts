import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { requireAdmin } from "@/lib/permissions";
import { isRhV2Enabled } from "@/lib/rh/flag";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

const CONTRACT_TYPES = ["CDI", "CDD", "SAISONNIER", "APPRENTISSAGE", "INTERIM", "STAGE", "ADMINISTRATEUR"];

async function guard() {
  if (!isRhV2Enabled()) return { err: NextResponse.json({ error: "Module RH V2 désactivé" }, { status: 404 }) };
  const session = await auth();
  if (!session?.user) return { err: NextResponse.json({ error: "Non autorisé" }, { status: 401 }) };
  if (!(await requireAdmin(session))) return { err: NextResponse.json({ error: "Réservé à la direction" }, { status: 403 }) };
  return { session };
}

/** GET /api/rh/contracts — salariés + leurs contrats (gestion direction). */
export async function GET() {
  const g = await guard(); if (g.err) return g.err;
  const employees = await prisma.employee.findMany({
    orderBy: [{ statutEmploi: "asc" }, { displayName: "asc" }, { email: "asc" }],
    select: {
      id: true, email: true, displayName: true, poste: true, service: true, statutEmploi: true,
      hireDate: true, sapSlpName: true,
      contracts: { orderBy: { dateDebut: "desc" } },
    },
  });
  return NextResponse.json({ ok: true, employees, types: CONTRACT_TYPES });
}

/**
 * POST /api/rh/contracts — crée un contrat. Body : { employeeId, type, dateDebut,
 * dateFin?, essaiFin?, heuresHebdo?, heuresAnnuelles?, classification?, tauxHoraire?,
 * saisonLabel?, motif?, reconductible?, cloturerPrecedents? }.
 * `cloturerPrecedents` (défaut true) passe les contrats actifs précédents en
 * « termine » (un seul contrat actif à la fois).
 */
export async function POST(req: NextRequest) {
  const g = await guard(); if (g.err) return g.err;
  let b: Record<string, unknown>;
  try { b = await req.json(); } catch { return NextResponse.json({ error: "JSON invalide" }, { status: 400 }); }

  const employeeId = String(b.employeeId ?? "");
  const type = String(b.type ?? "");
  if (!employeeId) return NextResponse.json({ error: "employeeId requis" }, { status: 400 });
  if (!CONTRACT_TYPES.includes(type)) return NextResponse.json({ error: "type invalide" }, { status: 400 });
  const dateDebut = b.dateDebut ? new Date(String(b.dateDebut)) : null;
  if (!dateDebut || Number.isNaN(dateDebut.getTime())) return NextResponse.json({ error: "dateDebut requise" }, { status: 400 });

  const emp = await prisma.employee.findUnique({ where: { id: employeeId }, select: { id: true } });
  if (!emp) return NextResponse.json({ error: "Salarié introuvable" }, { status: 404 });

  const dateFin = b.dateFin ? new Date(String(b.dateFin)) : null;
  const essaiFin = b.essaiFin ? new Date(String(b.essaiFin)) : null;

  const created = await prisma.$transaction(async (tx) => {
    if (b.cloturerPrecedents !== false) {
      await tx.contract.updateMany({ where: { employeeId, statut: "actif" }, data: { statut: "termine" } });
    }
    const c = await tx.contract.create({
      data: {
        employeeId, type, statut: "actif", dateDebut,
        dateFin: dateFin && !Number.isNaN(dateFin.getTime()) ? dateFin : null,
        essaiFin: essaiFin && !Number.isNaN(essaiFin.getTime()) ? essaiFin : null,
        heuresHebdo: typeof b.heuresHebdo === "number" ? b.heuresHebdo : 35,
        heuresAnnuelles: typeof b.heuresAnnuelles === "number" ? b.heuresAnnuelles : 1600,
        tempsPartiel: !!b.tempsPartiel,
        classification: b.classification ? String(b.classification) : null,
        tauxHoraire: typeof b.tauxHoraire === "number" ? b.tauxHoraire : null,
        saisonLabel: b.saisonLabel ? String(b.saisonLabel) : null,
        reconductible: !!b.reconductible,
        motif: b.motif ? String(b.motif) : null,
      },
    });
    // Trace turnover : changement/embauche de contrat.
    await tx.rhEvent.create({ data: { employeeId, type: "contrat", date: dateDebut, meta: JSON.stringify({ contractId: c.id, contractType: type }) } });
    return c;
  });

  return NextResponse.json({ ok: true, contract: created });
}
