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
import { DEFAULT_PROFILE, type DayHours, type HoursProfile } from "./heuresCalc";

const PROFIL_PREFIX = "rhprofil:";
const WEEK_PREFIX = "rhsem:";

export interface WeekEntry {
  days: DayHours[];        // 7 entrées (Lun→Dim)
  updatedAt: string;
  updatedBy: string;       // email de la dernière écriture (soi-même ou admin)
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

export async function getWeekEntry(email: string, weekId: string): Promise<WeekEntry | null> {
  try {
    const row = await prisma.appSetting.findUnique({ where: { key: `${WEEK_PREFIX}${emailKey(email)}:${weekId}` } });
    if (!row) return null;
    const v = JSON.parse(row.value) as Partial<WeekEntry>;
    return { days: sanitizeDays(v.days), updatedAt: v.updatedAt ?? "", updatedBy: v.updatedBy ?? "" };
  } catch {
    return null;
  }
}

export async function saveWeekEntry(email: string, weekId: string, days: unknown, by: string): Promise<WeekEntry> {
  const entry: WeekEntry = { days: sanitizeDays(days), updatedAt: new Date().toISOString(), updatedBy: by };
  const key = `${WEEK_PREFIX}${emailKey(email)}:${weekId}`;
  const value = JSON.stringify(entry);
  await prisma.appSetting.upsert({ where: { key }, update: { value }, create: { key, value } });
  return entry;
}

/** Toutes les saisies d'UNE semaine, par email (vue admin / PDF compta). */
export async function listWeekEntries(weekId: string): Promise<Map<string, WeekEntry>> {
  const out = new Map<string, WeekEntry>();
  try {
    const rows = await prisma.appSetting.findMany({ where: { key: { startsWith: WEEK_PREFIX } } });
    const suffix = `:${weekId}`;
    for (const r of rows) {
      if (!r.key.endsWith(suffix)) continue;
      const email = r.key.slice(WEEK_PREFIX.length, r.key.length - suffix.length);
      try {
        const v = JSON.parse(r.value) as Partial<WeekEntry>;
        out.set(email, { days: sanitizeDays(v.days), updatedAt: v.updatedAt ?? "", updatedBy: v.updatedBy ?? "" });
      } catch { /* ligne corrompue → ignorée */ }
    }
  } catch { /* saisies indisponibles */ }
  return out;
}
