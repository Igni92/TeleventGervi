/**
 * Horaires de travail PRÉVUS par contrat, avec MODULATION saisonnière (plusieurs
 * périodes dans l'année, chacune ses horaires par jour). Sert de référence au
 * planning (jours prévus) et à la présence quand la badgeuse est désactivée.
 *
 * Pauses : Code du travail L3121-16 — 20 min dès 6 h de travail quotidien (seuil
 * et durée paramétrables dans le règlement, la convention pouvant prévoir plus).
 */
import { REGLEMENT_1405, type RhReglementParams } from "./reglement";

/** Un jour travaillé : plage début→fin + pause (minutes). "HH:MM". */
export interface DaySpec { start: string; end: string; pauseMin?: number }
/** Une période de modulation : plage de dates (MM-DD, gère le chevauchement d'année)
 *  + horaires par jour ISO (clé "1"=lundi … "7"=dimanche ; jour absent = repos). */
export interface SchedulePeriod { label?: string; from: string; to: string; days: Record<string, DaySpec> }
export interface WeekSchedule { periods: SchedulePeriod[] }

const clampHM = (s: string | null | undefined): number | null => {
  if (!s) return null;
  const m = /^(\d{1,2}):(\d{2})/.exec(s.trim());
  if (!m) return null;
  const h = Number(m[1]); const mi = Number(m[2]);
  if (h > 23 || mi > 59) return null;
  return h * 60 + mi;
};
const grossSpan = (a: string, b: string): number => {
  const x = clampHM(a); const y = clampHM(b);
  if (x == null || y == null || y <= x) return 0;
  return y - x;
};
const addMin = (hm: string, min: number): string => {
  const base = clampHM(hm) ?? 0; const t = Math.max(0, Math.min(23 * 60 + 59, base + min));
  return `${String(Math.floor(t / 60)).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}`;
};

/** Pause effective d'un jour = max(pause saisie, pause légale si seuil atteint). */
export function dayPauseMinutes(spec: DaySpec, reg: RhReglementParams = REGLEMENT_1405): number {
  const gross = grossSpan(spec.start, spec.end);
  const legal = gross >= reg.pauseSeuilMinutes ? reg.pauseMinObligatoire : 0;
  return Math.max(spec.pauseMin ?? 0, legal);
}
/** Minutes NETTES travaillées d'un jour (plage − pause effective). */
export function netDayMinutes(spec: DaySpec, reg: RhReglementParams = REGLEMENT_1405): number {
  return Math.max(0, grossSpan(spec.start, spec.end) - dayPauseMinutes(spec, reg));
}

/** "MM-DD" d'une date UTC. */
const mmdd = (d: Date) => `${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
/** Vrai si la date (MM-DD) est dans [from,to], en gérant l'enjambement d'année (ex. 10-01→03-31). */
function inPeriod(p: SchedulePeriod, date: Date): boolean {
  const x = mmdd(date);
  if (p.from <= p.to) return x >= p.from && x <= p.to;
  return x >= p.from || x <= p.to; // chevauche le 31/12
}
/** Période active pour une date (première correspondance), sinon null. */
export function activePeriod(sched: WeekSchedule, date: Date): SchedulePeriod | null {
  return sched.periods.find((p) => inPeriod(p, date)) ?? null;
}
/** Spéc du jour (ISO lundi=1) pour une date, selon la période active. */
export function daySpecFor(sched: WeekSchedule, date: Date): DaySpec | null {
  const p = activePeriod(sched, date);
  if (!p) return null;
  const iso = ((date.getUTCDay() + 6) % 7) + 1; // 1=lundi … 7=dimanche
  return p.days[String(iso)] ?? null;
}
/** Minutes NETTES prévues pour une date précise (0 si repos/hors période). */
export function plannedNetForDate(sched: WeekSchedule, date: Date, reg: RhReglementParams = REGLEMENT_1405): number {
  const spec = daySpecFor(sched, date);
  return spec ? netDayMinutes(spec, reg) : 0;
}

/**
 * Horaire par DÉFAUT dérivé des heures hebdo : une seule période toute l'année,
 * lundi→vendredi, journée démarrant à 08:00, pause légale incluse pour atteindre
 * le net hebdomadaire du contrat.
 */
export function defaultSchedule(weeklyHours: number, reg: RhReglementParams = REGLEMENT_1405): WeekSchedule {
  const netPerDay = Math.max(0, Math.round(((weeklyHours || 0) * 60) / 5));
  const pause = netPerDay >= reg.pauseSeuilMinutes ? reg.pauseMinObligatoire : 0;
  const end = addMin("08:00", netPerDay + pause);
  const day: DaySpec = { start: "08:00", end, pauseMin: pause };
  const days: Record<string, DaySpec> = {};
  for (const iso of ["1", "2", "3", "4", "5"]) days[iso] = { ...day };
  return { periods: [{ label: "Toute l'année", from: "01-01", to: "12-31", days }] };
}

/** Parse le JSON stocké (Contract.horairesJson) ; repli sur l'horaire par défaut. */
export function parseSchedule(json: string | null | undefined, weeklyHours: number): WeekSchedule {
  if (json) {
    try {
      const o = JSON.parse(json);
      if (o && Array.isArray(o.periods) && o.periods.length > 0) return o as WeekSchedule;
    } catch { /* repli défaut */ }
  }
  return defaultSchedule(weeklyHours);
}

/** Minutes nettes prévues, jour par jour, pour une semaine (7 dates lun→dim). */
export function plannedWeek(sched: WeekSchedule, weekDates: Date[], reg: RhReglementParams = REGLEMENT_1405): number[] {
  return weekDates.map((d) => plannedNetForDate(sched, d, reg));
}
