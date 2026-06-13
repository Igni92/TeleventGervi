/**
 * Helpers semaine ISO 8601 + calendrier des événements commerciaux TeleVent.
 *
 * Purs (pas d'import Prisma / `@/`) → testables directement en vitest.
 *
 * Convention ISO : la semaine commence lundi ; la semaine 1 est celle qui
 * contient le 1er jeudi de l'année (≡ celle du 4 janvier). Une date de fin
 * décembre peut donc appartenir à la semaine 1 de l'année ISO suivante, et
 * un 1er janvier à la semaine 52/53 de l'année ISO précédente — d'où le couple
 * { year, week } toujours renvoyé ensemble.
 */

export interface IsoWeek {
  /** Année ISO (≠ année calendaire en bordure de décembre/janvier). */
  year: number;
  /** Numéro de semaine ISO 1..53. */
  week: number;
}

/** Numéro + année ISO d'une date. */
export function isoWeek(date: Date): IsoWeek {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  // Jeudi de la semaine courante (jour 4) : ISO ancre la semaine sur son jeudi.
  const dayNum = d.getUTCDay() || 7; // dimanche (0) → 7
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((d.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
  return { year: d.getUTCFullYear(), week };
}

/** Nombre de semaines ISO dans une année (52 ou 53). */
export function isoWeeksInYear(year: number): number {
  const jan1Dow = new Date(Date.UTC(year, 0, 1)).getUTCDay();
  const isLeap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
  // 53 semaines si le 1er janvier est un jeudi, ou un mercredi en année bissextile.
  if (jan1Dow === 4 || (isLeap && jan1Dow === 3)) return 53;
  return 52;
}

/** Lundi (00:00 local) de la semaine ISO (year, week). */
export function isoWeekStart(year: number, week: number): Date {
  // 4 janvier est toujours en semaine 1 ; on part de là.
  const jan4 = new Date(year, 0, 4);
  const jan4Dow = jan4.getDay() || 7;
  const week1Monday = new Date(jan4);
  week1Monday.setDate(jan4.getDate() - (jan4Dow - 1));
  const monday = new Date(week1Monday);
  monday.setDate(week1Monday.getDate() + (week - 1) * 7);
  monday.setHours(0, 0, 0, 0);
  return monday;
}

/** Libellé court d'une semaine : `S07`. */
export function isoWeekLabel(week: number): string {
  return `S${String(week).padStart(2, "0")}`;
}

/** Clé de map stable pour un couple année/semaine ISO. */
export function isoWeekKey(w: IsoWeek): string {
  return `${w.year}-${w.week}`;
}

/* ═════════════════════════════════════════════════════════════════
   Calendrier des événements commerciaux (saisonnalité fraises/fruits).
   Chaque événement sait calculer SA date pour une année donnée ; on en
   dérive ensuite la semaine ISO (qui bouge d'une année sur l'autre pour
   les fêtes mobiles — d'où le calcul par année et non un n° figé).
   ═════════════════════════════════════════════════════════════════ */

export interface CommercialEvent {
  key: string;
  label: string;
  emoji: string;
  /** Date de l'événement pour une année donnée (heure locale, 00:00). */
  date: (year: number) => Date;
}

/* ── Helpers dates mobiles ───────────────────────────────────────── */

/** Pâques (dimanche) — algorithme de Gauss/Anonymous Gregorian. */
export function easterSunday(year: number): Date {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31); // 3 = mars, 4 = avril
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(year, month - 1, day);
}

/** n-ième `weekday` (0=dim..6=sam) du mois `month0` (0-indexé). */
function nthWeekdayOfMonth(year: number, month0: number, weekday: number, n: number): Date {
  const first = new Date(year, month0, 1);
  const shift = (weekday - first.getDay() + 7) % 7;
  return new Date(year, month0, 1 + shift + (n - 1) * 7);
}

/** Dernier `weekday` (0=dim..6=sam) du mois `month0`. */
function lastWeekdayOfMonth(year: number, month0: number, weekday: number): Date {
  const last = new Date(year, month0 + 1, 0); // dernier jour du mois
  const shift = (last.getDay() - weekday + 7) % 7;
  return new Date(year, month0, last.getDate() - shift);
}

/** Fête des mères (France) : dernier dimanche de mai, repoussé au 1er dimanche
 *  de juin si ce dimanche coïncide avec la Pentecôte (Pâques + 49 j). */
export function feteDesMeres(year: number): Date {
  const lastSunMay = lastWeekdayOfMonth(year, 4, 0);
  const pentecote = new Date(easterSunday(year));
  pentecote.setDate(pentecote.getDate() + 49);
  if (lastSunMay.getTime() === pentecote.getTime()) {
    return nthWeekdayOfMonth(year, 5, 0, 1); // 1er dimanche de juin
  }
  return lastSunMay;
}

/** Liste ordonnée chronologiquement (par mois) des événements suivis. */
export const COMMERCIAL_EVENTS: CommercialEvent[] = [
  { key: "nouvel-an", label: "Nouvel An", emoji: "🎉", date: (y) => new Date(y, 0, 1) },
  { key: "galette", label: "Galette des rois (Épiphanie)", emoji: "👑", date: (y) => new Date(y, 0, 6) },
  { key: "chandeleur", label: "Chandeleur", emoji: "🥞", date: (y) => new Date(y, 1, 2) },
  { key: "saint-valentin", label: "Saint-Valentin", emoji: "❤️", date: (y) => new Date(y, 1, 14) },
  { key: "paques", label: "Pâques", emoji: "🐣", date: (y) => easterSunday(y) },
  { key: "fete-meres", label: "Fête des mères", emoji: "💐", date: (y) => feteDesMeres(y) },
  { key: "fete-peres", label: "Fête des pères", emoji: "👔", date: (y) => nthWeekdayOfMonth(y, 5, 0, 3) },
  { key: "14-juillet", label: "Fête nationale (14 juillet)", emoji: "🇫🇷", date: (y) => new Date(y, 6, 14) },
  { key: "halloween", label: "Halloween", emoji: "🎃", date: (y) => new Date(y, 9, 31) },
  { key: "toussaint", label: "Toussaint", emoji: "🕯️", date: (y) => new Date(y, 10, 1) },
  { key: "beaujolais", label: "Beaujolais nouveau", emoji: "🍷", date: (y) => nthWeekdayOfMonth(y, 10, 4, 3) },
  { key: "black-friday", label: "Black Friday", emoji: "🛒", date: (y) => nthWeekdayOfMonth(y, 10, 5, 4) },
  { key: "noel", label: "Noël", emoji: "🎄", date: (y) => new Date(y, 11, 25) },
];
