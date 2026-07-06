/**
 * GESTION HORAIRE HEBDOMADAIRE — calculs PURS (testés hors React/Prisma).
 *
 * L'employé saisit ses heures réelles (matin + après-midi) jour par jour ;
 * l'app compare au CONTRAT hebdomadaire (profil : heures hebdo + journée type)
 * et ventile l'écart :
 *   • total > contrat → HEURES SUPPLÉMENTAIRES, majorées à la française :
 *     les 8 premières heures au-delà du contrat à +25 %, le reste à +50 %
 *     (règle légale par défaut, art. L3121-36 C. trav., base 35 h) ;
 *   • total < contrat → heures de RÉCUPÉRATION (solde à rattraper / posé).
 * `majEquivMin` = équivalent payé des heures supp (25 % → ×1,25 ; 50 % → ×1,5),
 * la donnée qu'attend la compta pour la paie.
 */

/** Une journée saisie — plages matin (m1→m2) et après-midi (a1→a2), "HH:MM". */
export interface DayHours {
  m1?: string;
  m2?: string;
  a1?: string;
  a2?: string;
  /** Note du jour : CP, maladie, férié, récup… (information compta) */
  note?: string;
}

/** Profil horaire d'un employé : contrat hebdo + journée type (préremplissage). */
export interface HoursProfile {
  weeklyHours: number;    // heures contractuelles / semaine (ex. 35, 39)
  typicalDay: DayHours;   // « journée type » appliquée d'un clic sur Lun→Ven
}

export const DEFAULT_PROFILE: HoursProfile = {
  weeklyHours: 35,
  typicalDay: { m1: "06:00", m2: "13:00" },   // 7 h × 5 jours = 35 h
};

export const JOURS_SEMAINE = ["Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi", "Samedi", "Dimanche"] as const;

/** Tranche à +25 % : les 8 premières heures au-delà du contrat (puis +50 %). */
const SUP25_BAND_MIN = 8 * 60;

/** "HH:MM" → minutes depuis minuit, null si vide/invalide. */
export function parseHM(s: string | undefined | null): number | null {
  const t = (s ?? "").trim();
  if (!t) return null;
  const m = /^(\d{1,2}):(\d{2})$/.exec(t);
  if (!m) return null;
  const h = Number(m[1]), mn = Number(m[2]);
  if (h > 23 || mn > 59) return null;
  return h * 60 + mn;
}

/** Minutes travaillées d'une journée — chaque plage (matin / après-midi) doit
 *  être complète et cohérente (fin > début) pour compter ; sinon ignorée. */
export function dayMinutes(d: DayHours | undefined | null): number {
  if (!d) return 0;
  let total = 0;
  for (const [from, to] of [[d.m1, d.m2], [d.a1, d.a2]] as const) {
    const a = parseHM(from), b = parseHM(to);
    if (a != null && b != null && b > a) total += b - a;
  }
  return total;
}

export interface WeekCalc {
  dayMin: number[];       // minutes par jour (Lun→Dim)
  totalMin: number;       // total travaillé
  contractMin: number;    // contrat hebdo
  deltaMin: number;       // total − contrat (négatif = récup)
  sup25Min: number;       // heures supp à +25 % (8 premières)
  sup50Min: number;       // heures supp à +50 % (au-delà)
  recupMin: number;       // heures de récupération (si total < contrat)
  majEquivMin: number;    // équivalent PAYÉ des heures supp (×1,25 / ×1,5)
}

/** Calcule la semaine : total, écart au contrat, ventilation 25/50, récup. */
export function computeWeek(days: (DayHours | undefined)[], weeklyHours: number): WeekCalc {
  const dayMin = Array.from({ length: 7 }, (_, i) => dayMinutes(days[i]));
  const totalMin = dayMin.reduce((s, m) => s + m, 0);
  const contractMin = Math.max(0, Math.round((weeklyHours || 0) * 60));
  const deltaMin = totalMin - contractMin;
  const supMin = Math.max(0, deltaMin);
  const sup25Min = Math.min(supMin, SUP25_BAND_MIN);
  const sup50Min = Math.max(0, supMin - SUP25_BAND_MIN);
  const recupMin = Math.max(0, -deltaMin);
  const majEquivMin = Math.round(sup25Min * 1.25 + sup50Min * 1.5);
  return { dayMin, totalMin, contractMin, deltaMin, sup25Min, sup50Min, recupMin, majEquivMin };
}

/** Minutes → « 38h30 » (signe conservé : −150 → « −2h30 »). */
export function fmtHM(min: number): string {
  const sign = min < 0 ? "−" : "";
  const abs = Math.abs(Math.round(min));
  const h = Math.floor(abs / 60);
  const m = abs % 60;
  return `${sign}${h}h${String(m).padStart(2, "0")}`;
}

/* ───────────────────────── Semaines ISO (Lun→Dim) ─────────────────────────── */

/** Date → identifiant de semaine ISO « 2026-W27 ». */
export function isoWeekId(date: Date): string {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dow = d.getUTCDay() || 7;             // Lun=1 … Dim=7
  d.setUTCDate(d.getUTCDate() + 4 - dow);     // jeudi de la semaine ISO
  const year = d.getUTCFullYear();
  const jan1 = new Date(Date.UTC(year, 0, 1));
  const week = Math.ceil(((d.getTime() - jan1.getTime()) / 86_400_000 + 1) / 7);
  return `${year}-W${String(week).padStart(2, "0")}`;
}

/** Identifiant valide ? (année plausible + semaine 01–53) */
export function isWeekId(id: string): boolean {
  const m = /^(\d{4})-W(\d{2})$/.exec(id);
  if (!m) return false;
  const w = Number(m[2]);
  return w >= 1 && w <= 53;
}

/** Les 7 dates (Lun→Dim) d'une semaine ISO, en ISO « YYYY-MM-DD ». */
export function weekDates(weekId: string): string[] {
  const m = /^(\d{4})-W(\d{2})$/.exec(weekId);
  if (!m) return [];
  const year = Number(m[1]), week = Number(m[2]);
  // Le 4 janvier est TOUJOURS en semaine ISO 1 → lundi de W1, puis décalage.
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const monday = new Date(jan4);
  monday.setUTCDate(jan4.getUTCDate() - ((jan4.getUTCDay() || 7) - 1) + (week - 1) * 7);
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(monday);
    d.setUTCDate(monday.getUTCDate() + i);
    return d.toISOString().slice(0, 10);
  });
}

/** Semaine décalée de `delta` (±1 = semaine précédente/suivante). */
export function shiftWeek(weekId: string, delta: number): string {
  const dates = weekDates(weekId);
  if (dates.length === 0) return weekId;
  const monday = new Date(`${dates[0]}T12:00:00Z`);
  monday.setUTCDate(monday.getUTCDate() + delta * 7);
  return isoWeekId(new Date(monday.getUTCFullYear(), monday.getUTCMonth(), monday.getUTCDate()));
}

/** Libellé lisible : « Semaine 27 · 29 juin – 5 juillet 2026 ». */
export function weekLabel(weekId: string): string {
  const dates = weekDates(weekId);
  const m = /^(\d{4})-W(\d{2})$/.exec(weekId);
  if (dates.length === 0 || !m) return weekId;
  const fmt = (iso: string, opts: Intl.DateTimeFormatOptions) =>
    new Date(`${iso}T12:00:00Z`).toLocaleDateString("fr-FR", { timeZone: "UTC", ...opts });
  return `Semaine ${Number(m[2])} · ${fmt(dates[0], { day: "numeric", month: "long" })} – ${fmt(dates[6], { day: "numeric", month: "long", year: "numeric" })}`;
}
