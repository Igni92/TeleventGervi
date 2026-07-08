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
import { DEFAULT_PROFILE, isHeuresOption, type DayHours, type HeuresOption, type HoursProfile } from "./heuresCalc";

const PROFIL_PREFIX = "rhprofil:";
const WEEK_PREFIX = "rhsem:";

export interface WeekEntry {
  days: DayHours[];              // 7 entrées (Lun→Dim)
  /** Option compta des heures supp de la semaine (récup / paiement), null tant
   *  qu'aucun choix n'est fait. Reportée sur l'état mensuel (PDF). */
  option: HeuresOption | null;
  /** Dates de récup posées (option « recup »), ISO « YYYY-MM-DD » — absent sinon. */
  recupDates?: string[];
  updatedAt: string;
  updatedBy: string;             // email de la dernière écriture (soi-même ou admin)
}

const emailKey = (email: string) => email.trim().toLowerCase();

/* ─────────────────────────────── Profils ──────────────────────────────────── */

function normalizeProfile(v: unknown): HoursProfile {
  const p = (v ?? {}) as Partial<HoursProfile>;
  const weekly = Number(p.weeklyHours);
  return {
    weeklyHours: Number.isFinite(weekly) && weekly > 0 && weekly <= 80 ? Math.round(weekly * 100) / 100 : DEFAULT_PROFILE.weeklyHours,
    typicalDay: sanitizeDay(p.typicalDay) ?? { ...DEFAULT_PROFILE.typicalDay },
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
type RawEntry = { days?: unknown; option?: unknown; recupDates?: unknown };

/** Reconstruit une WeekEntry propre depuis un JSON stocké OU un payload client
 *  (les dates de récup ne sont conservées que pour l'option « recup »). */
function parseEntry(v: RawEntry, updatedAt: string, updatedBy: string): WeekEntry {
  const option = isHeuresOption(v.option) ? v.option : null;
  return {
    days: sanitizeDays(v.days),
    option,
    recupDates: option === "recup" ? sanitizeRecupDates(v.recupDates) : undefined,
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
  opts?: { option?: unknown; recupDates?: unknown },
): Promise<WeekEntry> {
  const entry = parseEntry(
    { days, option: opts?.option, recupDates: opts?.recupDates },
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

