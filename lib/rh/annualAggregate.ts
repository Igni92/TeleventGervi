/**
 * Agrégation ANNUALISATION (IDCC 1405, 1600 h) par salarié pour une année civile.
 * Réalisé = heures travaillées effectives sur la période : pointages badgeuse
 * (badgeuse ON) ou horaires prévus au contrat (badgeuse OFF), hors fériés et
 * absences approuvées. Passe par le moteur pur computeAnnual (lib/rh/annualisation).
 */
import { prisma } from "@/lib/prisma";
import { computeAnnual, fractionPresence, fractionEcoulee, type AnnualResult } from "./annualisation";
import { isBadgeuseEnabled } from "./settings";
import { parseSchedule, plannedNetForDate } from "./schedule";

export interface AnnualRow {
  employeeId: string; name: string; poste: string | null;
  saisonnier: boolean; contractHours: number; tauxHoraire: number | null;
  fractionPresence: number; fractionEcoulee: number;
  result: AnnualResult;
}
export interface AnnualBoard { year: number; badgeuse: boolean; rows: AnnualRow[] }

export function yearBounds(year: number): { start: Date; end: Date } {
  return { start: new Date(Date.UTC(year, 0, 1)), end: new Date(Date.UTC(year + 1, 0, 1)) };
}

const dk = (d: Date) => d.toISOString().slice(0, 10);

/** Construit le tableau d'annualisation pour une année civile. */
export async function gatherAnnual(year: number, now = new Date()): Promise<AnnualBoard> {
  const { start, end } = yearBounds(year);
  const [badgeuse, employees, contracts, clocks, holidays, leaves] = await Promise.all([
    isBadgeuseEnabled(),
    prisma.employee.findMany({ where: { statutEmploi: "actif" }, orderBy: [{ displayName: "asc" }, { email: "asc" }], select: { id: true, displayName: true, email: true, poste: true } }),
    prisma.contract.findMany({ where: { statut: "actif" }, select: { employeeId: true, heuresHebdo: true, horairesJson: true, tauxHoraire: true, type: true, dateDebut: true, dateFin: true, annualise: true } }),
    prisma.rhTimeClock.findMany({ where: { date: { gte: start, lt: end } }, select: { employeeId: true, heuresMin: true } }),
    prisma.rhHoliday.findMany({ where: { date: { gte: start, lt: end } }, select: { date: true } }),
    prisma.rhLeaveRequest.findMany({ where: { statut: "approved", startDate: { lt: end }, endDate: { gte: start } }, select: { employeeId: true, startDate: true, endDate: true } }),
  ]);

  const ctById = new Map(contracts.map((c) => [c.employeeId, c]));
  const clockMin = new Map<string, number>();
  for (const c of clocks) clockMin.set(c.employeeId, (clockMin.get(c.employeeId) ?? 0) + c.heuresMin);
  const holiSet = new Set(holidays.map((h) => dk(h.date)));
  const absent = new Set<string>();
  for (const l of leaves) {
    for (let t = new Date(l.startDate); t <= l.endDate; t = new Date(t.getTime() + 86400000)) absent.add(`${l.employeeId}|${dk(t)}`);
  }

  const rows: AnnualRow[] = employees.flatMap((emp) => {
    const ct = ctById.get(emp.id);
    // Seuls les contrats ANNUALISÉS figurent au tableau d'annualisation.
    if (!ct || ct.annualise === false) return [];
    const contractHours = ct.heuresHebdo ?? 35;
    const saisonnier = ct?.type === "SAISONNIER";
    const fPres = fractionPresence(start, end, ct?.dateDebut ?? null, ct?.dateFin ?? null);
    const fEcoul = fractionEcoulee(start, end, now);

    // Réalisé (minutes)
    let realisedMin = 0;
    if (badgeuse) {
      realisedMin = clockMin.get(emp.id) ?? 0;
    } else {
      const sched = parseSchedule(ct.horairesJson ?? null, contractHours);
      const from = ct.dateDebut > start ? ct.dateDebut : start;
      const to = ct.dateFin && ct.dateFin < end ? ct.dateFin : end;
      for (let d = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate())); d < to; d = new Date(d.getTime() + 86400000)) {
        const k = dk(d);
        if (k > dk(now)) break; // pas de futur dans le « réalisé »
        if (holiSet.has(k) || absent.has(`${emp.id}|${k}`)) continue;
        realisedMin += plannedNetForDate(sched, d);
      }
    }

    const result = computeAnnual({ heuresRealisees: realisedMin / 60, fractionPresence: fPres, fractionEcoulee: fEcoul }, saisonnier);
    return [{ employeeId: emp.id, name: emp.displayName ?? emp.email, poste: emp.poste, saisonnier, contractHours, tauxHoraire: ct.tauxHoraire ?? null, fractionPresence: fPres, fractionEcoulee: fEcoul, result }];
  });

  return { year, badgeuse, rows };
}
