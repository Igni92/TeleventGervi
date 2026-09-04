import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { requireAdmin } from "@/lib/permissions";
import { isRhV2Enabled } from "@/lib/rh/flag";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

const ELEMENT_TYPES = ["prime", "frais", "treizieme", "vehicule_an", "recup_paye", "commission", "autre"];
const monthOk = (m: unknown): m is string => typeof m === "string" && /^\d{4}-\d{2}$/.test(m);
function monthRange(mois: string): { start: Date; end: Date } {
  const [y, m] = mois.split("-").map(Number);
  return { start: new Date(Date.UTC(y, m - 1, 1)), end: new Date(Date.UTC(y, m, 1)) };
}

async function guard() {
  if (!isRhV2Enabled()) return { err: NextResponse.json({ error: "Module RH V2 désactivé" }, { status: 404 }) };
  const session = await auth();
  if (!session?.user) return { err: NextResponse.json({ error: "Non autorisé" }, { status: 401 }) };
  if (!(await requireAdmin(session))) return { err: NextResponse.json({ error: "Réservé à la direction" }, { status: 403 }) };
  return { email: session.user.email ?? null };
}

/** GET /api/rh/paie?mois=YYYY-MM — par salarié : heures travaillées du mois +
 *  éléments variables (primes, frais, 13e, récup payée, commission…). Direction. */
export async function GET(req: NextRequest) {
  const g = await guard(); if (g.err) return g.err;
  const raw = new URL(req.url).searchParams.get("mois");
  const mois = monthOk(raw) ? raw : new Date().toISOString().slice(0, 7);
  const { start, end } = monthRange(mois);

  const [employees, clocks, elements, sends] = await Promise.all([
    prisma.employee.findMany({ where: { statutEmploi: "actif" }, orderBy: [{ displayName: "asc" }, { email: "asc" }], select: { id: true, displayName: true, email: true, poste: true } }),
    prisma.rhTimeClock.findMany({ where: { date: { gte: start, lt: end } }, select: { employeeId: true, heuresMin: true } }),
    prisma.rhPayrollElement.findMany({ where: { mois }, orderBy: { createdAt: "asc" }, select: { id: true, employeeId: true, type: true, label: true, montant: true, statut: true } }),
    prisma.rhPayrollSend.findMany({ where: { mois }, orderBy: { sentAt: "desc" }, take: 5 }),
  ]);

  const workedByEmp = new Map<string, number>();
  for (const c of clocks) workedByEmp.set(c.employeeId, (workedByEmp.get(c.employeeId) ?? 0) + c.heuresMin);
  const elByEmp = new Map<string, typeof elements>();
  for (const e of elements) { const a = elByEmp.get(e.employeeId) ?? []; a.push(e); elByEmp.set(e.employeeId, a); }

  const rows = employees.map((emp) => {
    const els = elByEmp.get(emp.id) ?? [];
    return {
      employeeId: emp.id,
      name: emp.displayName ?? emp.email,
      poste: emp.poste,
      workedMin: workedByEmp.get(emp.id) ?? 0,
      elements: els,
      elementsTotal: els.reduce((s, e) => s + e.montant, 0),
    };
  });

  return NextResponse.json({ ok: true, mois, types: ELEMENT_TYPES, rows, sends });
}

/** POST /api/rh/paie — actions : add (élément) · delete · send (recap compta). */
export async function POST(req: NextRequest) {
  const g = await guard(); if (g.err) return g.err;
  let b: Record<string, unknown>;
  try { b = await req.json(); } catch { return NextResponse.json({ error: "JSON invalide" }, { status: 400 }); }
  const action = String(b.action ?? "");

  if (action === "add") {
    const employeeId = String(b.employeeId ?? "");
    const mois = b.mois; const type = String(b.type ?? "");
    if (!employeeId || !monthOk(mois) || !ELEMENT_TYPES.includes(type)) return NextResponse.json({ error: "Champs invalides" }, { status: 400 });
    const montant = typeof b.montant === "number" ? b.montant : Number(b.montant);
    if (!Number.isFinite(montant)) return NextResponse.json({ error: "Montant invalide" }, { status: 400 });
    const el = await prisma.rhPayrollElement.create({
      data: { employeeId, mois, type, label: b.label ? String(b.label) : null, montant, createdBy: g.email },
      select: { id: true, employeeId: true, type: true, label: true, montant: true, statut: true },
    });
    return NextResponse.json({ ok: true, element: el });
  }

  if (action === "delete") {
    const id = String(b.id ?? "");
    await prisma.rhPayrollElement.delete({ where: { id } }).catch(() => null);
    return NextResponse.json({ ok: true });
  }

  if (action === "send") {
    const mois = b.mois;
    if (!monthOk(mois)) return NextResponse.json({ error: "Mois invalide" }, { status: 400 });
    const to = Array.isArray(b.to) ? (b.to as unknown[]).map(String) : [];
    const send = await prisma.rhPayrollSend.create({ data: { mois, kind: "normal", to: JSON.stringify(to), sentBy: g.email } });
    await prisma.rhPayrollElement.updateMany({ where: { mois, statut: "saisi" }, data: { statut: "envoye" } });
    return NextResponse.json({ ok: true, send });
  }

  return NextResponse.json({ error: "action inconnue" }, { status: 400 });
}
