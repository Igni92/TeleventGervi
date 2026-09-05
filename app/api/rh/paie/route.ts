import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { requireAdmin } from "@/lib/permissions";
import { isRhV2Enabled } from "@/lib/rh/flag";
import { isBadgeuseEnabled } from "@/lib/rh/settings";
import { parseSchedule, plannedNetForDate } from "@/lib/rh/schedule";
import { isTreiziemeMonth, prorata13e, avantageNatureMensuel } from "@/lib/salaires";
import { listSalaryProfiles } from "@/lib/salairesRh";
import { commissionBalances } from "@/lib/commissions";
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
    prisma.employee.findMany({ where: { statutEmploi: "actif" }, orderBy: [{ displayName: "asc" }, { email: "asc" }], select: { id: true, displayName: true, email: true, poste: true, hireDate: true, sapSlpName: true } }),
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

  // ── ÉLÉMENTS AUTOMATIQUES (recalculés, non persistés) : commissions dues,
  //    avantage en nature véhicule, demi-13e, régularisation annualisation. Le
  //    gérant n'a rien à saisir — ils sont intégrés au total et à l'envoi compta.
  const round2 = (n: number) => Math.round(n * 100) / 100;
  const ctById = new Map(contracts.map((c) => [c.employeeId, c]));
  type Auto = { type: string; label: string; montant: number };
  const autoByEmp = new Map<string, Auto[]>();
  const addAuto = (empId: string, a: Auto) => { const l = autoByEmp.get(empId) ?? []; l.push(a); autoByEmp.set(empId, l); };

  // Sources externes (best-effort — un échec n'invalide pas la paie manuelle).
  const [commissions, salProfilesRaw] = await Promise.all([
    commissionBalances().catch(() => new Map()),
    listSalaryProfiles().catch(() => new Map()),
  ]);
  // Ré-indexe les profils salaire par email en minuscules (tolérant à la casse).
  const salProfiles = new Map<string, ReturnType<typeof salProfilesRaw.get>>();
  for (const [k, v] of salProfilesRaw) salProfiles.set(k.toLowerCase(), v);

  for (const emp of employees) {
    // 1) Commission due (reste à payer) — jointure par nom SAP (slpName).
    if (emp.sapSlpName) {
      const c = commissions.get(emp.sapSlpName);
      if (c && c.ecart > 0.005) addAuto(emp.id, { type: "commission", label: `Commission ventes (reste dû, ${Math.round((c.rate ?? 0) * 100)}%)`, montant: round2(c.ecart) });
    }
    // 2) Avantage en nature véhicule (mensuel) — profil salaire (AppSetting).
    const prof = emp.email ? salProfiles.get(emp.email.toLowerCase()) : null;
    if (prof?.vehicule) {
      const m = round2(avantageNatureMensuel(prof.vehicule));
      if (m > 0) addAuto(emp.id, { type: "vehicule_an", label: "Avantage en nature véhicule", montant: m });
    }
    // 3) Demi-13e mois (juin & décembre), prorata ancienneté — si activé (profil) ou taux connu.
    if (isTreiziemeMonth(mois)) {
      const ct = ctById.get(emp.id);
      const wants13 = prof?.treizieme === true || (prof?.treizieme == null && !!ct?.tauxHoraire);
      if (wants13 && ct?.tauxHoraire) {
        const prorata = prorata13e(emp.hireDate ? new Date(emp.hireDate).toISOString().slice(0, 10) : (prof?.cdiDate ?? null), mois) ?? 1;
        const montant = round2((ct.tauxHoraire * ct.heuresHebdo * 52 / 12 / 2) * prorata);
        if (prorata > 0 && montant > 0) addAuto(emp.id, { type: "treizieme", label: `½ 13e mois (${mois.endsWith("-06") ? "juin" : "décembre"}${prorata < 1 ? `, prorata ${Math.round(prorata * 100)}%` : ""})`, montant });
      }
    }
  }

  // 4) Régularisation annuelle de l'annualisation (décembre) — heures supp de
  //    l'année ×1,25, contrats annualisés seulement (gatherAnnual filtre déjà).
  if (mois.endsWith("-12")) {
    try {
      const board = await gatherAnnual(Number(mois.slice(0, 4)));
      for (const r of board.rows) {
        if (r.result.heuresSuppAnnee <= 0) continue;
        const taux = ctById.get(r.employeeId)?.tauxHoraire ?? 0;
        const montant = round2(r.result.heuresSuppAnnee * taux * 1.25);
        if (montant > 0) addAuto(r.employeeId, { type: "autre", label: `Régularisation annualisation — ${r.result.heuresSuppAnnee} h supp (+25 %)`, montant });
      }
    } catch { /* annualisation indispo → pas de régul auto */ }
  }

  const rows = employees.map((emp) => {
    const els = elByEmp.get(emp.id) ?? [];
    const auto = autoByEmp.get(emp.id) ?? [];
    return {
      employeeId: emp.id,
      name: emp.displayName ?? emp.email,
      poste: emp.poste,
      workedMin: workedByEmp.get(emp.id) ?? 0,
      elements: els,
      auto, // lignes automatiques (recalculées)
      elementsTotal: els.reduce((s, e) => s + e.montant, 0) + auto.reduce((s, a) => s + a.montant, 0),
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
