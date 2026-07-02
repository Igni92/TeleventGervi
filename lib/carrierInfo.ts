/**
 * Fiche transporteur — coordonnées de contact (email + téléphones ajoutables).
 *
 * Persistée par code transporteur SAP (U_TrspCode) dans AppSetting
 * (clé `carrierinfo:<CODE>`, valeur JSON), pour éviter toute migration —
 * même mécanisme que les statuts du Détail livraison. Sert au bon de
 * transport (envoi par mail au transporteur + coordonnées sur le document).
 */
import { prisma } from "@/lib/prisma";

const CARRIER_INFO_PREFIX = "carrierinfo:";

export interface CarrierPhone { label: string; value: string }
export interface CarrierInfo { email: string | null; phones: CarrierPhone[] }

const EMPTY: CarrierInfo = { email: null, phones: [] };

function keyOf(code: string): string {
  return CARRIER_INFO_PREFIX + code.trim().toUpperCase();
}

/** Nettoie une fiche entrante (email trim, téléphones non vides, plafonds). */
export function sanitizeCarrierInfo(input: { email?: unknown; phones?: unknown }): CarrierInfo {
  const email = typeof input.email === "string" && input.email.trim() ? input.email.trim().slice(0, 200) : null;
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
  return { email, phones };
}

/** Fiche d'UN transporteur (email + téléphones). Jamais d'exception. */
export async function getCarrierInfo(code: string): Promise<CarrierInfo> {
  try {
    const row = await prisma.appSetting.findUnique({ where: { key: keyOf(code) } });
    if (!row) return EMPTY;
    return sanitizeCarrierInfo(JSON.parse(row.value) as { email?: unknown; phones?: unknown });
  } catch {
    return EMPTY;
  }
}

/** Enregistre (ou vide) la fiche d'un transporteur. */
export async function setCarrierInfo(code: string, info: CarrierInfo): Promise<void> {
  const key = keyOf(code);
  if (!info.email && info.phones.length === 0) {
    try { await prisma.appSetting.delete({ where: { key } }); } catch { /* déjà absente */ }
    return;
  }
  const value = JSON.stringify(info);
  await prisma.appSetting.upsert({ where: { key }, update: { value }, create: { key, value } });
}
