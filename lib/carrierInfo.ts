/**
 * Fiche transporteur — coordonnées de contact (PLUSIEURS emails + téléphones).
 *
 * Persistée par code transporteur SAP (U_TrspCode) dans AppSetting
 * (clé `carrierinfo:<CODE>`, valeur JSON), pour éviter toute migration —
 * même mécanisme que les statuts du Détail livraison. Sert à la feuille de
 * route / bon de transport (envoi par mail au transporteur — interne ou
 * externe — et coordonnées sur le document).
 *
 * Compat : les fiches historiques stockaient un seul `email` (string). La
 * lecture migre automatiquement `email` → `emails: [email]`.
 *
 * Marqueur d'ENVOI : quand la feuille de route d'un transporteur est envoyée
 * pour un jour donné, on pose `frsent:<DATE>:<CODE>` (JSON { at, to, orders })
 * pour afficher la pastille « envoyé » côté livraisons — toujours sans migration.
 */
import { prisma } from "@/lib/prisma";

const CARRIER_INFO_PREFIX = "carrierinfo:";
const FEUILLE_SENT_PREFIX = "frsent:";

export interface CarrierPhone { label: string; value: string }
export interface CarrierInfo { emails: string[]; phones: CarrierPhone[] }

const EMPTY: CarrierInfo = { emails: [], phones: [] };

function keyOf(code: string): string {
  return CARRIER_INFO_PREFIX + code.trim().toUpperCase();
}

/** Nettoie une fiche entrante (emails valides dédupliqués, téléphones non vides,
 *  plafonds). Accepte `emails: string[]` OU l'ancien `email: string`. */
export function sanitizeCarrierInfo(input: { email?: unknown; emails?: unknown; phones?: unknown }): CarrierInfo {
  const raw: unknown[] = Array.isArray(input.emails)
    ? (input.emails as unknown[])
    : typeof input.email === "string"
    ? [input.email]
    : [];
  const seen = new Set<string>();
  const emails: string[] = [];
  for (const e of raw) {
    if (typeof e !== "string") continue;
    const v = e.trim().slice(0, 200);
    if (!v || !v.includes("@")) continue;
    const k = v.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    emails.push(v);
    if (emails.length >= 10) break;
  }
  const phones: CarrierPhone[] = Array.isArray(input.phones)
    ? (input.phones as unknown[])
        .map((p) => {
          const o = (p ?? {}) as { label?: unknown; value?: unknown };
          const value = typeof o.value === "string" ? o.value.trim().slice(0, 40) : "";
          const label = typeof o.label === "string" ? o.label.trim().slice(0, 60) : "";
          return { label, value };
        })
        .filter((p) => p.value)
        .slice(0, 10)
    : [];
  return { emails, phones };
}

/** Fiche d'UN transporteur (emails + téléphones). Jamais d'exception. */
export async function getCarrierInfo(code: string): Promise<CarrierInfo> {
  try {
    const row = await prisma.appSetting.findUnique({ where: { key: keyOf(code) } });
    if (!row) return EMPTY;
    return sanitizeCarrierInfo(JSON.parse(row.value) as { email?: unknown; emails?: unknown; phones?: unknown });
  } catch {
    return EMPTY;
  }
}

/** Enregistre (ou vide) la fiche d'un transporteur. */
export async function setCarrierInfo(code: string, info: CarrierInfo): Promise<void> {
  const key = keyOf(code);
  if (info.emails.length === 0 && info.phones.length === 0) {
    try { await prisma.appSetting.delete({ where: { key } }); } catch { /* déjà absente */ }
    return;
  }
  const value = JSON.stringify(info);
  await prisma.appSetting.upsert({ where: { key }, update: { value }, create: { key, value } });
}

/* ───────────────────────── Marqueur « feuille de route envoyée » ───────────── */

export interface FeuilleRouteSent { at: string; to: string[]; orders: number }

function sentKey(date: string, code: string): string {
  return `${FEUILLE_SENT_PREFIX}${date}:${code.trim().toUpperCase()}`;
}

/** Enregistre l'envoi de la feuille de route (jour + transporteur). */
export async function setFeuilleSent(date: string, code: string, info: FeuilleRouteSent): Promise<void> {
  const key = sentKey(date, code);
  const value = JSON.stringify(info);
  await prisma.appSetting.upsert({ where: { key }, update: { value }, create: { key, value } });
}

/** Marqueurs d'envoi pour plusieurs transporteurs d'un même jour (Map CODE→info). */
export async function getFeuilleSentMany(date: string, codes: string[]): Promise<Map<string, FeuilleRouteSent>> {
  const out = new Map<string, FeuilleRouteSent>();
  const uniq = Array.from(new Set(codes.filter(Boolean).map((c) => c.trim().toUpperCase())));
  if (uniq.length === 0) return out;
  try {
    const rows = await prisma.appSetting.findMany({ where: { key: { in: uniq.map((c) => sentKey(date, c)) } } });
    for (const r of rows) {
      const code = r.key.slice(`${FEUILLE_SENT_PREFIX}${date}:`.length);
      try {
        const v = JSON.parse(r.value) as FeuilleRouteSent;
        if (v && typeof v.at === "string") out.set(code, { at: v.at, to: Array.isArray(v.to) ? v.to : [], orders: Number(v.orders) || 0 });
      } catch { /* ignore ligne corrompue */ }
    }
  } catch { /* best-effort */ }
  return out;
}
