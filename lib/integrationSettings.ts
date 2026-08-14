/**
 * RÉGLAGES D'INTÉGRATION modifiables dans l'app (Paramètres → Administration) —
 * stockés en AppSetting, surchargent l'environnement. Deux familles :
 *
 *   • ENVOI DES RELANCES : boîte expéditrice, destinataire de TEST, mode live.
 *   • IDENTIFIANTS SAP référents : utilisateur + mot de passe du Service Layer.
 *
 * ⚠️ SÉCURITÉ / ROBUSTESSE : les identifiants SAP sont l'authentification de TOUT
 * le miroir. On lit toujours l'AppSetting EN PREMIER, avec REPLI sur l'ENV : vider
 * la surcharge (chaîne vide) rétablit instantanément les identifiants d'origine
 * (GERMM) — un mauvais réglage ne casse donc jamais SAP de façon irréversible.
 * Le mot de passe est stocké en base ; il n'est JAMAIS renvoyé en lecture (masqué).
 */
import { prisma } from "@/lib/prisma";

const KEYS = {
  from: "relance_from_address",
  testRecipient: "relance_test_recipient",
  live: "relance_live",
  sapUser: "sap_login_user",
  sapPass: "sap_login_password",
} as const;

/** Lit plusieurs AppSetting d'un coup (best-effort → Map vide si DB indispo). */
async function readSettings(keys: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  try {
    const rows = await prisma.appSetting.findMany({ where: { key: { in: keys } }, select: { key: true, value: true } });
    for (const r of rows) if (r.value != null) out.set(r.key, r.value);
  } catch { /* DB indispo → env/défauts */ }
  return out;
}

export interface RelanceEmailSettings {
  from: string;
  testRecipient: string;
  live: boolean;
}

/** Réglages d'envoi effectifs (AppSetting > env > défaut codé). */
export async function getRelanceEmailSettings(): Promise<RelanceEmailSettings> {
  const { DEFAULT_FROM_ADDRESS, DEFAULT_TEST_RECIPIENT } = await import("@/lib/relance/delivery");
  const s = await readSettings([KEYS.from, KEYS.testRecipient, KEYS.live]);
  const from = s.get(KEYS.from)?.trim() || process.env.RELANCE_FROM_ADDRESS?.trim() || DEFAULT_FROM_ADDRESS;
  const testRecipient = s.get(KEYS.testRecipient)?.trim() || process.env.RELANCE_TEST_RECIPIENT?.trim() || DEFAULT_TEST_RECIPIENT;
  // Live = "1" en AppSetting, sinon repli sur l'env. Prudence : le défaut reste TEST.
  const liveOverride = s.get(KEYS.live);
  const live = liveOverride != null ? liveOverride === "1" : process.env.RELANCE_LIVE === "1";
  return { from, testRecipient, live };
}

export interface SapCredentialOverride {
  user: string | null;
  pass: string | null;
}

/** Surcharge des identifiants SAP (null si non définie → l'appelant garde l'env). */
export async function getSapCredentialOverride(): Promise<SapCredentialOverride> {
  const s = await readSettings([KEYS.sapUser, KEYS.sapPass]);
  return {
    user: s.get(KEYS.sapUser)?.trim() || null,
    pass: s.get(KEYS.sapPass) || null, // pas de trim : un mot de passe peut avoir des espaces
  };
}

export { KEYS as INTEGRATION_KEYS };
