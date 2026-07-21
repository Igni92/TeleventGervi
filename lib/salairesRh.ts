/**
 * ÉLÉMENTS DES SALAIRES — persistance (AppSetting, comme les heures : rhprofil:,
 * rhsem:…). Les calculs et le récap email vivent dans lib/salaires (pur, testé).
 *
 *   • `salprofil:<email>`         → SalaryProfile (date CDI, 13e mois, véhicule AN)
 *   • `salmois:<email>:<YYYY-MM>` → SalaryMonthData (primes + frais du mois)
 *   • `salrecap:<YYYY-MM>`        → trace d'envoi du récap au comptable
 */
import { prisma } from "./prisma";
import {
  VEHICULE_ENERGIES,
  type SalaryEnvoi, type SalaryFrais, type SalaryMonthData, type SalaryPrime, type SalaryProfile, type VehiculeAN,
} from "./salaires";

const PROFIL_PREFIX = "salprofil:";
const MOIS_PREFIX = "salmois:";
const RECAP_PREFIX = "salrecap:";
const ENVOI_PREFIX = "salenvoi:";        // salenvoi:<id> → un envoi (PDF) au cabinet
const COMPTA_EMAILS_KEY = "salcompta:emails";  // destinataires du cabinet (CSV)
const COMMISSIONS_PAID_KEY = "salcommissions:paidThrough"; // dernier mois de commissions déjà réglé (YYYY-MM)

const emailKey = (email: string) => email.trim().toLowerCase();

/* ────────────────────────────── Sanitisation ──────────────────────────────── */

const str = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");

/** Montant € borné [0 ; 1 000 000], arrondi au centime — 0 si invalide. */
function money(v: unknown): number {
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.round(Math.min(n, 1_000_000) * 100) / 100;
}

const MONTH_RE = /^\d{4}-\d{2}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function sanitizePrime(v: unknown, fallbackMonth: string): SalaryPrime | null {
  if (v == null || typeof v !== "object") return null;
  const p = v as Partial<SalaryPrime>;
  const motif = str(p.motif, 80);
  const montant = money(p.montant);
  if (!motif && montant <= 0) return null;   // ligne vide → ignorée
  return {
    id: str(p.id, 40) || Math.random().toString(36).slice(2, 10),
    motif: motif || "Prime",
    montant,
    bulletinDe: typeof p.bulletinDe === "string" && MONTH_RE.test(p.bulletinDe) ? p.bulletinDe : fallbackMonth,
    note: str(p.note, 200) || undefined,
    auto: p.auto === true || undefined,
  };
}

function sanitizeFrais(v: unknown): SalaryFrais | null {
  if (v == null || typeof v !== "object") return null;
  const f = v as Partial<SalaryFrais>;
  const motif = str(f.motif, 80);
  const montant = money(f.montant);
  if (!motif && montant <= 0) return null;
  return {
    id: str(f.id, 40) || Math.random().toString(36).slice(2, 10),
    motif: motif || "Frais",
    montant,
    note: str(f.note, 200) || undefined,
  };
}

/** Reconstruit des éléments de mois propres depuis un JSON stocké OU un payload
 *  client (plafond 30 lignes par liste — garde-fou). */
export function sanitizeMonthData(v: unknown, monthId: string, updatedAt: string, updatedBy: string): SalaryMonthData {
  const d = (v ?? {}) as { primes?: unknown; frais?: unknown; note?: unknown };
  const primes = (Array.isArray(d.primes) ? d.primes : [])
    .map((p) => sanitizePrime(p, monthId)).filter((p): p is SalaryPrime => !!p).slice(0, 30);
  const frais = (Array.isArray(d.frais) ? d.frais : [])
    .map(sanitizeFrais).filter((f): f is SalaryFrais => !!f).slice(0, 30);
  return { primes, frais, note: str(d.note, 500) || undefined, updatedAt, updatedBy };
}

function sanitizeVehicule(v: unknown): VehiculeAN | null {
  if (v == null || typeof v !== "object") return null;
  const x = v as Partial<VehiculeAN>;
  const type = str(x.type, 60);
  const immat = str(x.immatriculation, 20).toUpperCase();
  const valeur = money(x.valeurAchat);
  if (!type && !immat && valeur <= 0) return null;   // fiche vide → pas de véhicule
  return {
    type: type || "Véhicule",
    energie: VEHICULE_ENERGIES.includes(x.energie as never) ? (x.energie as VehiculeAN["energie"]) : "diesel",
    immatriculation: immat,
    valeurAchat: valeur,
    plusDe5Ans: x.plusDe5Ans === true,
    carburantRembourse: x.carburantRembourse === true,
    usage: str(x.usage, 80),
  };
}

export function sanitizeProfile(v: unknown): SalaryProfile {
  const p = (v ?? {}) as Partial<SalaryProfile>;
  return {
    cdiDate: typeof p.cdiDate === "string" && DATE_RE.test(p.cdiDate) ? p.cdiDate : null,
    treizieme: p.treizieme === true,
    vehicule: sanitizeVehicule(p.vehicule),
  };
}

/* ─────────────────────────────── Lecture / écriture ───────────────────────── */

export async function getSalaryProfile(email: string): Promise<SalaryProfile> {
  try {
    const row = await prisma.appSetting.findUnique({ where: { key: PROFIL_PREFIX + emailKey(email) } });
    return row ? sanitizeProfile(JSON.parse(row.value)) : sanitizeProfile(null);
  } catch {
    return sanitizeProfile(null);
  }
}

export async function saveSalaryProfile(email: string, profile: unknown): Promise<SalaryProfile> {
  const clean = sanitizeProfile(profile);
  const key = PROFIL_PREFIX + emailKey(email);
  const value = JSON.stringify(clean);
  await prisma.appSetting.upsert({ where: { key }, update: { value }, create: { key, value } });
  return clean;
}

/** Tous les profils paie, par email (écran équipe + récap). */
export async function listSalaryProfiles(): Promise<Map<string, SalaryProfile>> {
  const out = new Map<string, SalaryProfile>();
  try {
    const rows = await prisma.appSetting.findMany({ where: { key: { startsWith: PROFIL_PREFIX } } });
    for (const r of rows) {
      try { out.set(r.key.slice(PROFIL_PREFIX.length), sanitizeProfile(JSON.parse(r.value))); } catch { /* corrompu → défaut */ }
    }
  } catch { /* indisponible */ }
  return out;
}

export async function getSalaryMonth(email: string, monthId: string): Promise<SalaryMonthData | null> {
  try {
    const row = await prisma.appSetting.findUnique({ where: { key: `${MOIS_PREFIX}${emailKey(email)}:${monthId}` } });
    if (!row) return null;
    const v = JSON.parse(row.value) as Partial<SalaryMonthData>;
    return sanitizeMonthData(v, monthId, v.updatedAt ?? "", v.updatedBy ?? "");
  } catch {
    return null;
  }
}

export async function saveSalaryMonth(email: string, monthId: string, data: unknown, by: string): Promise<SalaryMonthData> {
  const clean = sanitizeMonthData(data, monthId, new Date().toISOString(), by);
  const key = `${MOIS_PREFIX}${emailKey(email)}:${monthId}`;
  const value = JSON.stringify(clean);
  await prisma.appSetting.upsert({ where: { key }, update: { value }, create: { key, value } });
  return clean;
}

/** Les éléments de TOUT LE MONDE pour UN mois — un scan du préfixe. */
export async function listSalaryMonths(monthId: string): Promise<Map<string, SalaryMonthData>> {
  const out = new Map<string, SalaryMonthData>();
  try {
    const rows = await prisma.appSetting.findMany({ where: { key: { startsWith: MOIS_PREFIX } } });
    const suffix = `:${monthId}`;
    for (const r of rows) {
      const rest = r.key.slice(MOIS_PREFIX.length);
      if (!rest.endsWith(suffix)) continue;
      const email = rest.slice(0, -suffix.length);
      try {
        const v = JSON.parse(r.value) as Partial<SalaryMonthData>;
        out.set(email, sanitizeMonthData(v, monthId, v.updatedAt ?? "", v.updatedBy ?? ""));
      } catch { /* corrompu → ignoré */ }
    }
  } catch { /* indisponible */ }
  return out;
}

/* ───────────────────────── Trace d'envoi au comptable ─────────────────────── */

export interface RecapSent { sentAt: string; sentBy: string; to: string[] }

export async function getRecapSent(monthId: string): Promise<RecapSent | null> {
  try {
    const row = await prisma.appSetting.findUnique({ where: { key: RECAP_PREFIX + monthId } });
    if (!row) return null;
    const v = JSON.parse(row.value) as Partial<RecapSent>;
    if (!v.sentAt) return null;
    return { sentAt: v.sentAt, sentBy: v.sentBy ?? "", to: Array.isArray(v.to) ? v.to.filter((t): t is string => typeof t === "string") : [] };
  } catch {
    return null;
  }
}

export async function markRecapSent(monthId: string, by: string, to: string[]): Promise<RecapSent> {
  const rec: RecapSent = { sentAt: new Date().toISOString(), sentBy: by, to };
  const key = RECAP_PREFIX + monthId;
  const value = JSON.stringify(rec);
  await prisma.appSetting.upsert({ where: { key }, update: { value }, create: { key, value } });
  return rec;
}

/* ─────────── Commissions : dernier mois DÉJÀ RÉGLÉ (curseur de rattrapage) ───
 * Les commissions sont payées mensuellement. Ce curseur mémorise le dernier
 * mois dont la commission a été versée : la paie du mois M inclut la somme des
 * commissions des mois (curseur, M]. Vide = rien n'a jamais été payé → la
 * prochaine paie rattrape tout l'arriéré depuis le début (lib/commissions).
 * Avancé automatiquement à l'envoi du récap ; ajustable à la main dans l'UI. */
const MONTH_RE_STR = /^\d{4}-\d{2}$/;

export async function getCommissionsPaidThrough(): Promise<string | null> {
  try {
    const row = await prisma.appSetting.findUnique({ where: { key: COMMISSIONS_PAID_KEY } });
    const v = (row?.value ?? "").replace(/^"|"$/g, "").trim();
    return MONTH_RE_STR.test(v) ? v : null;
  } catch {
    return null;
  }
}

/** Fixe le curseur (YYYY-MM, ou null pour « rien réglé »). */
export async function setCommissionsPaidThrough(month: string | null): Promise<string | null> {
  const clean = month && MONTH_RE_STR.test(month) ? month : null;
  const value = JSON.stringify(clean);
  await prisma.appSetting.upsert({ where: { key: COMMISSIONS_PAID_KEY }, update: { value }, create: { key: COMMISSIONS_PAID_KEY, value } });
  return clean;
}

/** Avance le curseur à `month` sans jamais reculer (appelé à l'envoi du récap). */
export async function advanceCommissionsPaidThrough(month: string): Promise<string | null> {
  if (!MONTH_RE_STR.test(month)) return getCommissionsPaidThrough();
  const cur = await getCommissionsPaidThrough();
  if (cur && cur >= month) return cur; // comparaison lexicographique = chronologique
  return setCommissionsPaidThrough(month);
}

/* ─────────── Destinataires du cabinet comptable (CSV, réglable dans l'UI) ──── */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Normalise une saisie « a@x.fr, b@y.fr » en liste d'emails valides (max 10). */
export function parseComptaEmails(v: unknown): string[] {
  const raw = typeof v === "string" ? v : Array.isArray(v) ? v.join(",") : "";
  return [...new Set(raw.split(/[,;\s]+/).map((s) => s.trim().toLowerCase()).filter((s) => EMAIL_RE.test(s)))].slice(0, 10);
}

export async function getComptaEmails(): Promise<string[]> {
  try {
    const row = await prisma.appSetting.findUnique({ where: { key: COMPTA_EMAILS_KEY } });
    return row ? parseComptaEmails(row.value) : [];
  } catch {
    return [];
  }
}

export async function setComptaEmails(v: unknown): Promise<string[]> {
  const emails = parseComptaEmails(v);
  const value = JSON.stringify(emails);
  await prisma.appSetting.upsert({ where: { key: COMPTA_EMAILS_KEY }, update: { value }, create: { key: COMPTA_EMAILS_KEY, value } });
  return emails;
}

/* ─────────── Journal des envois (liste des documents transmis) ────────────── */

function parseEnvoi(id: string, value: string): SalaryEnvoi | null {
  try {
    const v = JSON.parse(value) as Partial<SalaryEnvoi>;
    if (!v.monthId || !v.sentAt) return null;
    return {
      id,
      monthId: v.monthId,
      sentAt: v.sentAt,
      sentBy: typeof v.sentBy === "string" ? v.sentBy : "",
      to: Array.isArray(v.to) ? v.to.filter((t): t is string => typeof t === "string") : [],
      kind: v.kind === "rectif" ? "rectif" : "normal",
      filename: typeof v.filename === "string" ? v.filename : `elements-salaires-${v.monthId}.pdf`,
    };
  } catch {
    return null;
  }
}

/** Journalise un envoi (PDF transmis) et retourne la trace créée. */
export async function logEnvoi(e: Omit<SalaryEnvoi, "id" | "sentAt">): Promise<SalaryEnvoi> {
  const id = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const rec: SalaryEnvoi = {
    id,
    monthId: e.monthId,
    sentAt: new Date().toISOString(),
    sentBy: e.sentBy,
    to: e.to,
    kind: e.kind,
    filename: e.filename,
  };
  const key = ENVOI_PREFIX + id;
  await prisma.appSetting.upsert({ where: { key }, update: { value: JSON.stringify(rec) }, create: { key, value: JSON.stringify(rec) } });
  return rec;
}

/** Tous les envois, plus récents d'abord (garde-fou 200). */
export async function listEnvois(): Promise<SalaryEnvoi[]> {
  try {
    const rows = await prisma.appSetting.findMany({ where: { key: { startsWith: ENVOI_PREFIX } } });
    return rows
      .map((r) => parseEnvoi(r.key.slice(ENVOI_PREFIX.length), r.value))
      .filter((e): e is SalaryEnvoi => !!e)
      .sort((a, b) => (a.sentAt < b.sentAt ? 1 : -1))
      .slice(0, 200);
  } catch {
    return [];
  }
}
