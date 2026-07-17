/**
 * ACCÈS COMPTABLE PAR MOT DE PASSE — compta@gervifrais.com est une BOÎTE
 * PARTAGÉE Microsoft : pas de connexion SSO possible. Le cabinet se connecte
 * donc par mot de passe dédié (provider Credentials, cf. lib/auth), un canal
 * SÉPARÉ de Microsoft qui ne crée JAMAIS de ligne `User` (sessions JWT sans
 * adapter) — le comptable n'entre pas dans l'effectif (heures, planning,
 * salaires ne le listent pas).
 *
 * Le mot de passe est stocké HACHÉ (scrypt + sel, comparaison à temps
 * constant) dans AppSetting `comptapass:<email>` — jamais en clair. Repli :
 * variable d'env COMPTA_PASSWORD_HASH (même format `scrypt$sel$hash`).
 * Rotation : section « Accès comptable » de /salaires (admin/direction) ou
 * scripts/set-compta-password.mjs.
 */
import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { prisma } from "./prisma";

const KEY_LEN = 64;
const PREFIX = "comptapass:";

export const COMPTA_PASSWORD_MIN_LENGTH = 12;

/** Hache un mot de passe → « scrypt$<sel hex>$<hash hex> ». */
export function hashComptaPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, KEY_LEN).toString("hex");
  return `scrypt$${salt}$${hash}`;
}

/** Vérifie un mot de passe contre un hash stocké (temps constant). */
export function verifyComptaPassword(password: string, stored: string | null | undefined): boolean {
  if (!password || !stored) return false;
  const [algo, salt, hash] = stored.split("$");
  if (algo !== "scrypt" || !salt || !hash) return false;
  try {
    const calc = scryptSync(password, salt, hash.length / 2);
    return timingSafeEqual(calc, Buffer.from(hash, "hex"));
  } catch {
    return false;
  }
}

const keyOf = (email: string) => PREFIX + email.trim().toLowerCase();

/** Hash stocké pour cet email (AppSetting, repli env) — null si jamais défini. */
export async function getComptaPasswordHash(email: string): Promise<string | null> {
  try {
    const row = await prisma.appSetting.findUnique({ where: { key: keyOf(email) } });
    if (row?.value) return row.value;
  } catch { /* base indisponible → repli env */ }
  return process.env.COMPTA_PASSWORD_HASH || null;
}

/** Définit / remplace le mot de passe (haché) — longueur minimale imposée. */
export async function setComptaPassword(email: string, password: string): Promise<void> {
  if (password.length < COMPTA_PASSWORD_MIN_LENGTH) {
    throw new Error(`Mot de passe trop court (minimum ${COMPTA_PASSWORD_MIN_LENGTH} caractères)`);
  }
  const key = keyOf(email);
  const value = hashComptaPassword(password);
  await prisma.appSetting.upsert({ where: { key }, update: { value }, create: { key, value } });
}
