#!/usr/bin/env node
/**
 * Définit / change le MOT DE PASSE de l'accès comptable (compta@gervifrais.com)
 * directement en base (AppSetting `comptapass:<email>`) — même format scrypt
 * que lib/comptaAuth. Alternative CLI à la section « Accès cabinet comptable »
 * de /salaires (admin).
 *
 *   DATABASE_URL=... node scripts/set-compta-password.mjs "MonMotDePasse!"
 *   DATABASE_URL=... node scripts/set-compta-password.mjs            # → généré
 */
import { PrismaClient } from "@prisma/client";
import { randomBytes, scryptSync } from "node:crypto";

const EMAIL = process.env.COMPTA_LOGIN_EMAIL || "compta@gervifrais.com";
const MIN_LENGTH = 12;

function generatePassword() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789!#%+*";
  return [...randomBytes(18)].map((b) => alphabet[b % alphabet.length]).join("");
}

const provided = process.argv[2];
if (provided && provided.length < MIN_LENGTH) {
  console.error(`Mot de passe trop court (minimum ${MIN_LENGTH} caractères).`);
  process.exit(1);
}
const password = provided || generatePassword();

const salt = randomBytes(16).toString("hex");
const hash = scryptSync(password, salt, 64).toString("hex");
const value = `scrypt$${salt}$${hash}`;
const key = `comptapass:${EMAIL.toLowerCase()}`;

const prisma = new PrismaClient();
try {
  await prisma.appSetting.upsert({ where: { key }, update: { value }, create: { key, value } });
  console.log(`Mot de passe comptable défini pour ${EMAIL}.`);
  if (!provided) console.log(`Mot de passe généré (à transmettre au cabinet) : ${password}`);
} finally {
  await prisma.$disconnect();
}
