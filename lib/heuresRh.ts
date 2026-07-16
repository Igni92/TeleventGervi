/**
 * GESTION HORAIRE HEBDOMADAIRE — persistance (AppSetting, comme les autres
 * réglages métier : inv:, bonprep:, emaffect:…).
 *
 *   • `rhprofil:<email>`          → HoursProfile (contrat hebdo + journée type)
 *   • `rhsem:<email>:<YYYY-Www>`  → WeekEntry (7 jours saisis + traçabilité)
 *
 * Les calculs (heures supp 25/50, récup, équivalent payé) vivent dans
 * lib/heuresCalc (pur, testé) — ici uniquement lecture/écriture.
 */
import { prisma } from "./prisma";
import { DEFAULT_PROFILE, isDayTag, isHeuresOption, type DayHours, type HeuresOption, type HoursProfile } from "./heuresCalc";

const PROFIL_PREFIX = "rhprofil:";
const WEEK_PREFIX = "rhsem:";

export interface WeekEntry {
  days: DayHours[];              // 7 entrées (Lun→Dim)
  /** Option compta des heures supp de la semaine (récup / paiement / mixte),
   *  null tant qu'aucun choix n'est fait. Reportée sur l'état mensuel (PDF). */
  option: HeuresOption | null;
  /** Option « mixte » : minutes de supp (brutes) PAYÉES — le reste part au
   *  compteur de récup. Absent pour les autres options. */
  paySuppMin?: number;
  /** Dates de récup posées (options « recup »/« mixte »), ISO « YYYY-MM-DD » — absent sinon. */
  recupDates?: string[];
  updatedAt: string;
  updatedBy: string;             // email de la dernière écriture (soi-même ou admin)
}

const emailKey = (email: string) => email.trim().toLowerCase();

/* ─────────────────────────────── Profils ──────────────────────────────────── */

/** Nombre borné [0..max] arrondi au 1/100, ou null si absent/invalide —
 *  réglages EMPLOYEUR (solde CP en jours, plafond récup en heures). */
function boundedOrNull(v: unknown, max: number): number | null {
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0 || n > max) return null;
  return Math.round(n * 100) / 100;
}

function normalizeProfile(v: unknown): HoursProfile {
  const p = (v ?? {}) as Partial<HoursProfile>;
  const weekly = Number(p.weeklyHours);
  return {
    weeklyHours: Number.isFinite(weekly) && weekly > 0 && weekly <= 80 ? Math.round(weekly * 100) / 100 : DEFAULT_PROFILE.weeklyHours,
    typicalDay: sanitizeDay(p.typicalDay) ?? { ...DEFAULT_PROFILE.typicalDay },
    cpAllowanceDays: boundedOrNull(p.cpAllowanceDays, 365),
    recupCapHours: boundedOrNull(p.recupCapHours, 1000),
  };
}

export async function getProfile(email: string): Promise<HoursProfile> {
  try {
    const row = await prisma.appSetting.findUnique({ where: { key: PROFIL_PREFIX + emailKey(email) } });
    return row ? normalizeProfile(JSON.parse(row.value)) : { ...DEFAULT_PROFILE };
  } catch {
    return { ...DEFAULT_PROFILE };
  }
}

export async function saveProfile(email: string, profile: unknown): Promise<HoursProfile> {
  const clean = normalizeProfile(profile);
  const key = PROFIL_PREFIX + emailKey(email);
  const value = JSON.stringify(clean);
  await prisma.appSetting.upsert({ where: { key }, update: { value }, create: { key, value } });
  return clean;
}

export async function listProfiles(): Promise<Map<string, HoursProfile>> {
  const out = new Map<string, HoursProfile>();
  try {
    const rows = await prisma.appSetting.findMany({ where: { key: { startsWith: PROFIL_PREFIX } } });
    for (const r of rows) {
      try { out.set(r.key.slice(PROFIL_PREFIX.length), normalizeProfile(JSON.parse(r.value))); } catch { /* ligne corrompue → défaut */ }
    }
  } catch { /* profils indisponibles → défauts */ }
  return out;
}

/* ─────────────────────────────── Semaines ─────────────────────────────────── */

const HM_RE = /^\d{1,2}:\d{2}$/;

function sanitizeDay(v: unknown): DayHours | null {
  if (v == null || typeof v !== "object") return null;
  const d = v as Partial<DayHours>;
  const hm = (s: unknown) => (typeof s === "string" && HM_RE.test(s.trim()) ? s.trim() : undefined);
  const out: DayHours = {
    m1: hm(d.m1), m2: hm(d.m2), a1: hm(d.a1), a2: hm(d.a2),
    tag: isDayTag(d.tag) ? d.tag : undefined,
    note: typeof d.note === "string" && d.note.trim() ? d.note.trim().slice(0, 80) : undefined,
  };
  return out;
}

/** Valide/normalise les 7 jours d'une semaine saisie (entrées invalides vidées). */
export function sanitizeDays(v: unknown): DayHours[] {
  const arr = Array.isArray(v) ? v : [];
  return Array.from({ length: 7 }, (_, i) => sanitizeDay(arr[i]) ?? {});
}

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Date « YYYY-MM-DD » réelle (rejette 2026-02-30, mois/jours hors bornes…). */
function isIsoDate(s: string): boolean {
  if (!ISO_DATE_RE.test(s)) return false;
  const d = new Date(`${s}T12:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

/** Dates de récup : ISO valides, dédupliquées, triées, plafond 7 (une semaine).
 *  undefined si aucune → l'entrée reste compacte. */
function sanitizeRecupDates(v: unknown): string[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const out: string[] = [];
  for (const x of v) {
    const s = typeof x === "string" ? x.trim() : "";
    if (isIsoDate(s) && !out.includes(s)) out.push(s);
    if (out.length >= 7) break;
  }
  return out.length ? out.sort() : undefined;
}

/** Champs bruts (JSON stocké OU payload client) avant nettoyage. */
type RawEntry = { days?: unknown; option?: unknown; paySuppMin?: unknown; recupDates?: unknown };

/** Minutes payées (option « mixte ») : entier positif borné à une semaine
 *  pleine (7 × 24 h) — le plafonnement aux supp RÉELLES se fait au calcul
 *  (effectivePaySuppMin), jamais en stockage. undefined si absent/invalide. */
function sanitizePaySuppMin(v: unknown): number | undefined {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return undefined;
  return Math.min(Math.round(n), 7 * 24 * 60);
}

/** Reconstruit une WeekEntry propre depuis un JSON stocké OU un payload client
 *  (dates de récup conservées pour « recup »/« mixte », minutes payées pour
 *  « mixte » uniquement). */
function parseEntry(v: RawEntry, updatedAt: string, updatedBy: string): WeekEntry {
  const option = isHeuresOption(v.option) ? v.option : null;
  return {
    days: sanitizeDays(v.days),
    option,
    paySuppMin: option === "mixte" ? sanitizePaySuppMin(v.paySuppMin) : undefined,
    recupDates: option === "recup" || option === "mixte" ? sanitizeRecupDates(v.recupDates) : undefined,
    updatedAt,
    updatedBy,
  };
}

export async function getWeekEntry(email: string, weekId: string): Promise<WeekEntry | null> {
  try {
    const row = await prisma.appSetting.findUnique({ where: { key: `${WEEK_PREFIX}${emailKey(email)}:${weekId}` } });
    if (!row) return null;
    const v = JSON.parse(row.value) as Partial<WeekEntry>;
    return parseEntry(v, v.updatedAt ?? "", v.updatedBy ?? "");
  } catch {
    return null;
  }
}

export async function saveWeekEntry(
  email: string,
  weekId: string,
  days: unknown,
  by: string,
  opts?: { option?: unknown; paySuppMin?: unknown; recupDates?: unknown },
): Promise<WeekEntry> {
  const entry = parseEntry(
    { days, option: opts?.option, paySuppMin: opts?.paySuppMin, recupDates: opts?.recupDates },
    new Date().toISOString(),
    by,
  );
  const key = `${WEEK_PREFIX}${emailKey(email)}:${weekId}`;
  const value = JSON.stringify(entry);
  await prisma.appSetting.upsert({ where: { key }, update: { value }, create: { key, value } });
  return entry;
}

/** Les saisies d'UN employé pour une LISTE de semaines (état mensuel). */
export async function getUserWeeks(email: string, weekIds: string[]): Promise<Map<string, WeekEntry>> {
  const out = new Map<string, WeekEntry>();
  if (weekIds.length === 0) return out;
  const e = emailKey(email);
  try {
    const rows = await prisma.appSetting.findMany({
      where: { key: { in: weekIds.map((w) => `${WEEK_PREFIX}${e}:${w}`) } },
    });
    for (const r of rows) {
      const weekId = r.key.slice(r.key.lastIndexOf(":") + 1);
      try {
        const v = JSON.parse(r.value) as Partial<WeekEntry>;
        out.set(weekId, parseEntry(v, v.updatedAt ?? "", v.updatedBy ?? ""));
      } catch { /* ligne corrompue → ignorée */ }
    }
  } catch { /* saisies indisponibles */ }
  return out;
}

/** TOUTES les saisies d'UN employé (tous ses `rhsem:<email>:*`) — base des
 *  COMPTEURS (récup/CP) qui portent sur l'historique complet, pas un seul mois. */
export async function listUserWeekEntries(email: string): Promise<Map<string, WeekEntry>> {
  const out = new Map<string, WeekEntry>();
  const prefix = `${WEEK_PREFIX}${emailKey(email)}:`;
  try {
    const rows = await prisma.appSetting.findMany({ where: { key: { startsWith: prefix } } });
    for (const r of rows) {
      const weekId = r.key.slice(prefix.length);
      try {
        const v = JSON.parse(r.value) as Partial<WeekEntry>;
        out.set(weekId, parseEntry(v, v.updatedAt ?? "", v.updatedBy ?? ""));
      } catch { /* ligne corrompue → ignorée */ }
    }
  } catch { /* saisies indisponibles */ }
  return out;
}

/** TOUTES les saisies de TOUT LE MONDE, par email puis par semaine — compteurs
 *  de l'équipe (planning direction) en un seul scan du préfixe. */
export async function listAllWeekEntries(): Promise<Map<string, Map<string, WeekEntry>>> {
  const out = new Map<string, Map<string, WeekEntry>>();
  try {
    const rows = await prisma.appSetting.findMany({ where: { key: { startsWith: WEEK_PREFIX } } });
    for (const r of rows) {
      const rest = r.key.slice(WEEK_PREFIX.length);
      const i = rest.lastIndexOf(":");
      if (i <= 0) continue;
      const email = rest.slice(0, i);
      const weekId = rest.slice(i + 1);
      try {
        const v = JSON.parse(r.value) as Partial<WeekEntry>;
        let byWeek = out.get(email);
        if (!byWeek) { byWeek = new Map(); out.set(email, byWeek); }
        byWeek.set(weekId, parseEntry(v, v.updatedAt ?? "", v.updatedBy ?? ""));
      } catch { /* ligne corrompue → ignorée */ }
    }
  } catch { /* saisies indisponibles */ }
  return out;
}

/** Pose un TAG sur des jours donnés (dates ISO) dans les semaines d'un employé —
 *  utilisé quand un congé/récup est VALIDÉ (boomerang) : le calendrier retombe
 *  automatiquement dans la feuille d'heures (un jour « congés » y est crédité
 *  d'une journée type). Les heures déjà saisies ne sont JAMAIS écrasées, seul
 *  le tag est posé. Regroupe par semaine → une écriture par semaine. */
export async function tagDaysInWeeks(
  email: string,
  dates: string[],
  tag: DayHours["tag"],
  by: string,
  weekIdOf: (dateISO: string) => string,
  weekDatesOf: (weekId: string) => string[],
): Promise<void> {
  const byWeek = new Map<string, string[]>();
  for (const d of dates) {
    if (!isIsoDate(d)) continue;
    const w = weekIdOf(d);
    const list = byWeek.get(w);
    if (list) list.push(d); else byWeek.set(w, [d]);
  }
  for (const [weekId, ds] of byWeek) {
    const cur = await getWeekEntry(email, weekId);
    const days = cur ? [...cur.days] : Array.from({ length: 7 }, () => ({} as DayHours));
    const weekDays = weekDatesOf(weekId);
    let changed = false;
    for (const d of ds) {
      const idx = weekDays.indexOf(d);
      if (idx < 0) continue;
      if (days[idx]?.tag !== tag) { days[idx] = { ...days[idx], tag }; changed = true; }
    }
    if (!changed) continue;
    await saveWeekEntry(email, weekId, days, by, { option: cur?.option ?? null, paySuppMin: cur?.paySuppMin, recupDates: cur?.recupDates });
  }
}

/** Toutes les saisies d'un ENSEMBLE de semaines, par email puis par semaine
 *  (état mensuel équipe) — un seul scan du préfixe. */
export async function listEntriesForWeeks(weekIds: string[]): Promise<Map<string, Map<string, WeekEntry>>> {
  const out = new Map<string, Map<string, WeekEntry>>();
  if (weekIds.length === 0) return out;
  const wanted = new Set(weekIds);
  try {
    const rows = await prisma.appSetting.findMany({ where: { key: { startsWith: WEEK_PREFIX } } });
    for (const r of rows) {
      const rest = r.key.slice(WEEK_PREFIX.length);
      const i = rest.lastIndexOf(":");
      if (i <= 0) continue;
      const email = rest.slice(0, i);
      const weekId = rest.slice(i + 1);
      if (!wanted.has(weekId)) continue;
      try {
        const v = JSON.parse(r.value) as Partial<WeekEntry>;
        let byWeek = out.get(email);
        if (!byWeek) { byWeek = new Map(); out.set(email, byWeek); }
        byWeek.set(weekId, parseEntry(v, v.updatedAt ?? "", v.updatedBy ?? ""));
      } catch { /* ligne corrompue → ignorée */ }
    }
  } catch { /* saisies indisponibles */ }
  return out;
}

