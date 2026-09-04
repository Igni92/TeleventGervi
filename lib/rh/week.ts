/**
 * Agrégation TEMPS d'équipe (RH V2) — construit, pour une semaine ISO, la feuille
 * de chaque salarié à partir du SOCLE NEUF : pointages badgeuse (RhTimeClock.
 * heuresMin), congés approuvés (RhLeaveRequest), jours fériés (RhHoliday), contrat
 * actif (Contract.heuresHebdo). Le calcul par semaine passe par le moteur unique
 * `computeWeek` (lib/rh/time), validé par l'oracle de régression.
 *
 * Réutilisé par les écrans Heures & pointages et Planning.
 */
import { prisma } from "@/lib/prisma";
import { computeWeek, typicalDayMinutes, type DayTag, type WeekCalc } from "@/lib/rh/time";
import { parseSchedule, plannedWeek } from "@/lib/rh/schedule";
import { isBadgeuseEnabled } from "@/lib/rh/settings";

// ── Maths semaine ISO (en UTC, jours à 00:00) ───────────────────────────────
function toUTCDay(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}
function mondayOf(d: Date): Date {
  const u = toUTCDay(d);
  const dow = (u.getUTCDay() + 6) % 7; // 0 = lundi
  u.setUTCDate(u.getUTCDate() - dow);
  return u;
}
export function isoWeekString(d: Date): string {
  const mon = mondayOf(d);
  const thu = new Date(mon); thu.setUTCDate(mon.getUTCDate() + 3); // jeudi = année ISO
  const yearStart = new Date(Date.UTC(thu.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((thu.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${thu.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}
/** Lundi (UTC 00:00) d'une semaine ISO "YYYY-Www". */
export function mondayOfIso(iso: string): Date {
  const m = /^(\d{4})-W(\d{2})$/.exec(iso);
  const now = new Date();
  if (!m) return mondayOf(now);
  const y = Number(m[1]); const w = Number(m[2]);
  const jan4 = new Date(Date.UTC(y, 0, 4)); // toujours en semaine ISO 1
  const jan4dow = (jan4.getUTCDay() + 6) % 7;
  const week1Mon = new Date(jan4); week1Mon.setUTCDate(jan4.getUTCDate() - jan4dow);
  const mon = new Date(week1Mon); mon.setUTCDate(week1Mon.getUTCDate() + (w - 1) * 7);
  return mon;
}
/** Les 7 jours (UTC 00:00) d'une semaine ISO, lundi → dimanche. */
export function weekDays(iso: string): Date[] {
  const mon = mondayOfIso(iso);
  return Array.from({ length: 7 }, (_, i) => { const d = new Date(mon); d.setUTCDate(mon.getUTCDate() + i); return d; });
}
export function currentIsoWeek(): string { return isoWeekString(new Date()); }
/** Décale une semaine ISO de ±n semaines. */
export function shiftIsoWeek(iso: string, deltaWeeks: number): string {
  const mon = mondayOfIso(iso); mon.setUTCDate(mon.getUTCDate() + deltaWeeks * 7);
  return isoWeekString(mon);
}

const dayKey = (d: Date) => d.toISOString().slice(0, 10);
const leaveTypeToTag = (t: string): DayTag =>
  t === "cp" || t === "conges" ? "conges" : t === "recup" ? "recup" : t === "maladie" ? "maladie" : "absent";

export interface TeamDay { plannedMin: number; actualMin: number; min: number; tag: DayTag | null }
export interface TeamRow {
  employeeId: string;
  name: string;
  poste: string | null;
  contractHours: number;
  days: TeamDay[];       // 7 jours (lun→dim)
  calc: WeekCalc;
  validationStatus: string; // draft | sent | counter | agreed
}
export interface TeamWeek {
  isoWeek: string;
  days: string[];        // 7 dates ISO "YYYY-MM-DD"
  holidays: string[];    // dates fériées de la semaine
  badgeuse: boolean;     // badgeuse activée ? (false → présence = horaires contrat)
  rows: TeamRow[];
}

/** Construit la semaine d'équipe (tous salariés actifs) à partir du socle neuf. */
export async function gatherTeamWeek(iso: string): Promise<TeamWeek> {
  const days = weekDays(iso);
  const start = days[0]; const end = new Date(days[6]); end.setUTCDate(end.getUTCDate() + 1);
  const dayKeys = days.map(dayKey);

  const [badgeuse, employees, contracts, clocks, leaves, holidays, sheets] = await Promise.all([
    isBadgeuseEnabled(),
    prisma.employee.findMany({ where: { statutEmploi: "actif" }, orderBy: [{ displayName: "asc" }, { email: "asc" }], select: { id: true, displayName: true, email: true, poste: true } }),
    prisma.contract.findMany({ where: { statut: "actif" }, select: { employeeId: true, heuresHebdo: true, horairesJson: true } }),
    prisma.rhTimeClock.findMany({ where: { date: { gte: start, lt: end } }, select: { employeeId: true, date: true, heuresMin: true } }),
    prisma.rhLeaveRequest.findMany({ where: { statut: "approved", startDate: { lt: end }, endDate: { gte: start } }, select: { employeeId: true, type: true, startDate: true, endDate: true } }),
    prisma.rhHoliday.findMany({ where: { date: { gte: start, lt: end } }, select: { date: true } }),
    prisma.rhWeekSheet.findMany({ where: { isoWeek: iso }, select: { employeeId: true, validationStatus: true, days: true } }),
  ]);

  const contractByEmp = new Map(contracts.map((c) => [c.employeeId, c]));
  const sheetByEmp = new Map(sheets.map((s) => [s.employeeId, s]));
  const holidaySet = new Set(holidays.map((h) => dayKey(h.date)));
  // minutes badgées : (empId|dayKey) → minutes
  const clockMap = new Map<string, number>();
  for (const c of clocks) clockMap.set(`${c.employeeId}|${dayKey(c.date)}`, c.heuresMin);
  // congés : (empId|dayKey) → tag
  const leaveMap = new Map<string, DayTag>();
  for (const l of leaves) {
    const s = toUTCDay(l.startDate); const e = toUTCDay(l.endDate);
    for (const d of days) {
      if (d >= s && d <= e) leaveMap.set(`${l.employeeId}|${dayKey(d)}`, leaveTypeToTag(l.type));
    }
  }
  // Overrides manuels du planning (RhWeekSheet.days JSON = [{min?,tag?} ×7]).
  const parseDays = (json: string): ({ min?: number; tag?: DayTag } | null)[] => {
    try { const a = JSON.parse(json); return Array.isArray(a) ? a : []; } catch { return []; }
  };

  const rows: TeamRow[] = employees.map((emp) => {
    const contract = contractByEmp.get(emp.id);
    const contractHours = contract?.heuresHebdo ?? 35;
    const typical = typicalDayMinutes(contractHours);
    const sched = parseSchedule(contract?.horairesJson ?? null, contractHours);
    const planned = plannedWeek(sched, days);
    const sheet = sheetByEmp.get(emp.id);
    const overrides = sheet ? parseDays(sheet.days) : [];
    const workedMin: number[] = []; const tags: (DayTag | null)[] = []; const teamDays: TeamDay[] = [];
    for (let i = 0; i < 7; i++) {
      const d = days[i]; const k = dayKey(d);
      const plannedMin = planned[i];
      const ov = overrides[i];
      let tag: DayTag | null = null; let worked = 0; let actual = clockMap.get(`${emp.id}|${k}`) ?? 0;
      if (ov && (ov.tag || typeof ov.min === "number")) {
        // Édition manuelle du planning (prioritaire).
        tag = ov.tag ?? ((ov.min ?? 0) > 0 ? "present" : null);
        actual = typeof ov.min === "number" ? ov.min : actual;
        worked = tag && tag !== "present" ? 0 : (typeof ov.min === "number" ? ov.min : plannedMin);
      } else if (holidaySet.has(k)) {
        tag = "ferie"; worked = 0;
      } else if (badgeuse) {
        if (actual > 0) { tag = "present"; worked = actual; }
        else if (leaveMap.has(`${emp.id}|${k}`)) { tag = leaveMap.get(`${emp.id}|${k}`)!; worked = 0; }
      } else {
        // Badgeuse désactivée → présence = horaires prévus au contrat (sauf absence).
        if (leaveMap.has(`${emp.id}|${k}`)) { tag = leaveMap.get(`${emp.id}|${k}`)!; worked = 0; }
        else if (plannedMin > 0) { tag = "present"; worked = plannedMin; actual = plannedMin; }
      }
      workedMin.push(worked); tags.push(tag);
      teamDays.push({ plannedMin, actualMin: actual, min: 0, tag });
    }
    const calc = computeWeek(workedMin, tags, contractHours, typical);
    for (let i = 0; i < 7; i++) teamDays[i].min = calc.dayMin[i];
    return {
      employeeId: emp.id, name: emp.displayName ?? emp.email, poste: emp.poste,
      contractHours, days: teamDays, calc,
      validationStatus: sheet?.validationStatus ?? "draft",
    };
  });

  return { isoWeek: iso, days: dayKeys, holidays: [...holidaySet], badgeuse, rows };
}
