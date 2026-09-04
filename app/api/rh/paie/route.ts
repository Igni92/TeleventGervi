import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { requireAdmin } from "@/lib/permissions";
import { isRhV2Enabled } from "@/lib/rh/flag";
import { isBadgeuseEnabled } from "@/lib/rh/settings";
import { parseSchedule, plannedNetForDate } from "@/lib/rh/schedule";
import { isTreiziemeMonth, prorata13e } from "@/lib/salaires";
import { gatherAnnual } from "@/lib/rh/annualAggregate";
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

  const [badgeuse, employees, clocks, elements, sends, contracts, holidays, leaves] = await Promise.all([
    isBadgeuseEnabled(),
    prisma.employee.findMany({ where: { statutEmploi: "actif" }, orderBy: [{ displayName: "asc" }, { email: "asc" }], select: { id: true, displayName: true, email: true, poste: true, hireDate: true } }),
    prisma.rhTimeClock.findMany({ where: { date: { gte: start, lt: end } }, select: { employeeId: true, heuresMin: true } }),
    prisma.rhPayrollElement.findMany({ where: { mois }, orderBy: { createdAt: "asc" }, select: { id: true, employeeId: true, type: true, label: true, montant: true, statut: true } }),
    prisma.rhPayrollSend.findMany({ where: { mois }, orderBy: { sentAt: "desc" }, take: 5 }),
    prisma.contract.findMany({ where: { statut: "actif" }, select: { employeeId: true, heuresHebdo: true, horairesJson: true, tauxHoraire: true } }),
    prisma.rhHoliday.findMany({ where: { date: { gte: start, lt: end } }, select: { date: true } }),
    prisma.rhLeaveRequest.findMany({ where: { statut: "approved", startDate: { lt: end }, endDate: { gte: start } }, select: { employeeId: true, startDate: true, endDate: true } }),
  ]);

  const workedByEmp = new Map<string, number>();
  if (badgeuse) {
    for (const c of clocks) workedByEmp.set(c.employeeId, (workedByEmp.get(c.employeeId) ?? 0) + c.heuresMin);
  } else {
    // Badgeuse OFF → heures du mois = horaires prévus au contrat, hors fériés et absences approuvées.
    const dk = (d: Date) => d.toISOString().slice(0, 10);
    const holiSet = new Set(holidays.map((h) => dk(h.date)));
    const absent = new Set<string>();
    for (const l of leaves) {
      for (let t = new Date(l.startDate); t <= l.endDate; t = new Date(t.getTime() + 86400000)) absent.add(`${l.employeeId}|${dk(t)}`);
    }
    const ctById = new Map(contracts.map((c) => [c.employeeId, c]));
    for (const emp of employees) {
      const ct = ctById.get(emp.id); if (!ct) continue;
      const sched = parseSchedule(ct.horairesJson ?? null, ct.heuresHebdo);
      let tot = 0;
      for (let d = new Date(start); d < end; d = new Date(d.getTime() + 86400000)) {
        const k = dk(d);
        if (holiSet.has(k) || absent.has(`${emp.id}|${k}`)) continue;
        tot += plannedNetForDate(sched, d);
      }
      workedByEmp.set(emp.id, tot);
    }
  }
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

  // ── Suggestions d'éléments (non persistées) : demi-13e (juin/déc) + régularisation
  //    annualisation (décembre). Le gérant les ajoute d'un clic.
  const ctById = new Map(contracts.map((c) => [c.employeeId, c]));
  const suggestions: Record<string, { type: string; label: string; montant: number }[]> = {};
  const push = (empId: string, s: { type: string; label: string; montant: number }) => { (suggestions[empId] = suggestions[empId] ?? []).push(s); };
  const round2 = (n: number) => Math.round(n * 100) / 100;

  if (isTreiziemeMonth(mois)) {
    const semestre = mois.endsWith("-06") ? "juin" : "décembre";
    for (const emp of employees) {
      const ct = ctById.get(emp.id); if (!ct?.tauxHoraire) continue;
      const prorata = prorata13e(emp.hireDate ? new Date(emp.hireDate).toISOString().slice(0, 10) : null, mois) ?? 1;
      if (prorata <= 0) continue;
      const baseMensuelle = ct.tauxHoraire * ct.heuresHebdo * 52 / 12;
      const montant = round2((baseMensuelle / 2) * prorata);
      if (montant > 0) push(emp.id, { type: "treizieme", label: `½ 13e mois (${semestre}${prorata < 1 ? `, prorata ${Math.round(prorata * 100)}%` : ""})`, montant });
    }
  }

  if (mois.endsWith("-12")) {
    // Régularisation annuelle de l'annualisation : les heures supp de l'année,
    // majorées +25 %, à régler en fin de période.
    try {
      const board = await gatherAnnual(Number(mois.slice(0, 4)));
      for (const r of board.rows) {
        if (r.result.heuresSuppAnnee <= 0) continue;
        const ct = ctById.get(r.employeeId);
        const taux = ct?.tauxHoraire ?? 0;
        const montant = round2(r.result.heuresSuppAnnee * taux * 1.25);
        push(r.employeeId, { type: "autre", label: `Régularisation annualisation — ${r.result.heuresSuppAnnee} h supp (+25 %)`, montant });
      }
    } catch { /* annualisation indispo → pas de suggestion */ }
  }

  return NextResponse.json({ ok: true, mois, types: ELEMENT_TYPES, rows, sends, suggestions });
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
