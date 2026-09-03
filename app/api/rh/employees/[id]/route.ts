import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { requireAdmin } from "@/lib/permissions";
import { isRhV2Enabled } from "@/lib/rh/flag";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

async function guard() {
  if (!isRhV2Enabled()) return { err: NextResponse.json({ error: "Module RH V2 désactivé" }, { status: 404 }) };
  const session = await auth();
  if (!session?.user) return { err: NextResponse.json({ error: "Non autorisé" }, { status: 401 }) };
  if (!(await requireAdmin(session))) return { err: NextResponse.json({ error: "Réservé à la direction" }, { status: 403 }) };
  return { session };
}

/** GET /api/rh/employees/[id] — FICHE + JOURNAL (contrats, évènements, congés). */
export async function GET(_req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const g = await guard(); if (g.err) return g.err;
  const { id } = await props.params;
  const emp = await prisma.employee.findUnique({
    where: { id },
    include: {
      contracts: { orderBy: { dateDebut: "desc" } },
      events: { orderBy: { date: "desc" }, take: 200 },
      leaves: { orderBy: { startDate: "desc" }, take: 100 },
    },
  });
  if (!emp) return NextResponse.json({ error: "Salarié introuvable" }, { status: 404 });
  return NextResponse.json({ ok: true, employee: emp });
}

/**
 * POST /api/rh/employees/[id] — actions RH sur le salarié :
 *  - { action:"depart", exitDate, exitReason } : FIN DE CONTRAT / départ — clôture
 *    les contrats actifs, marque le salarié « sorti », trace le journal (turnover).
 *  - { action:"reactivate" } : ré-active un salarié sorti.
 *  - { action:"update", ...champs } : édite la fiche (poste, service, sapSlpName…).
 *  - { action:"note", text } : ajoute une note au journal.
 */
export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const g = await guard(); if (g.err) return g.err;
  const { id } = await props.params;
  const email = g.session.user?.email ?? null;
  let b: Record<string, unknown>;
  try { b = await req.json(); } catch { return NextResponse.json({ error: "JSON invalide" }, { status: 400 }); }
  const action = String(b.action ?? "");

  const emp = await prisma.employee.findUnique({ where: { id }, select: { id: true } });
  if (!emp) return NextResponse.json({ error: "Salarié introuvable" }, { status: 404 });

  if (action === "depart") {
    const exitDate = b.exitDate ? new Date(String(b.exitDate)) : new Date();
    if (Number.isNaN(exitDate.getTime())) return NextResponse.json({ error: "Date invalide" }, { status: 400 });
    const reason = b.exitReason ? String(b.exitReason) : null;
    await prisma.$transaction([
      prisma.contract.updateMany({ where: { employeeId: id, statut: "actif" }, data: { statut: "termine", dateFin: exitDate } }),
      prisma.employee.update({ where: { id }, data: { statutEmploi: "sorti", exitDate, exitReason: reason } }),
      prisma.rhEvent.create({ data: { employeeId: id, type: "depart", date: exitDate, createdBy: email, meta: JSON.stringify({ reason }) } }),
    ]);
    return NextResponse.json({ ok: true });
  }

  if (action === "reactivate") {
    await prisma.employee.update({ where: { id }, data: { statutEmploi: "actif", exitDate: null, exitReason: null } });
    await prisma.rhEvent.create({ data: { employeeId: id, type: "retour", date: new Date(), createdBy: email } });
    return NextResponse.json({ ok: true });
  }

  if (action === "update") {
    const data: Record<string, unknown> = {};
    for (const k of ["firstName", "lastName", "displayName", "poste", "service", "phone", "sapSlpName", "matricule"] as const) {
      if (k in b) data[k] = b[k] ? String(b[k]) : null;
    }
    let newHire: Date | null = null;
    if ("hireDate" in b) {
      if (b.hireDate) { const d = new Date(String(b.hireDate)); if (!Number.isNaN(d.getTime())) { data.hireDate = d; newHire = d; } }
      else data.hireDate = null;
    }
    if ("sapSlpCode" in b) data.sapSlpCode = typeof b.sapSlpCode === "number" ? b.sapSlpCode : null;
    await prisma.employee.update({ where: { id }, data });
    // La date d'ENTRÉE pilote la date de début du contrat ACTIF (date de signature
    // affichée dans la liste des contrats) — demande direction.
    if (newHire) {
      await prisma.contract.updateMany({ where: { employeeId: id, statut: "actif" }, data: { dateDebut: newHire } });
    }
    return NextResponse.json({ ok: true });
  }

  if (action === "note") {
    const text = String(b.text ?? "").trim();
    if (!text) return NextResponse.json({ error: "Note vide" }, { status: 400 });
    await prisma.rhEvent.create({ data: { employeeId: id, type: "note", date: new Date(), createdBy: email, meta: JSON.stringify({ text }) } });
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: "action inconnue" }, { status: 400 });
}
