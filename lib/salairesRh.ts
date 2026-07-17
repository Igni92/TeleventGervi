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
  type SalaryFrais, type SalaryMonthData, type SalaryPrime, type SalaryProfile, type VehiculeAN,
} from "./salaires";

const PROFIL_PREFIX = "salprofil:";
const MOIS_PREFIX = "salmois:";
const RECAP_PREFIX = "salrecap:";

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
