/**
 * DDL idempotent — colonnes de risque crédit sur "SapBusinessPartner" :
 *   creditLimit           DOUBLE PRECISION (SAP CreditLimit — plafond autorisé)
 *   currentAccountBalance DOUBLE PRECISION (SAP CurrentAccountBalance — solde dû)
 *   frozen                BOOLEAN NOT NULL DEFAULT false (SAP Frozen — compte gelé)
 *
 * Alimentées par le miroir (lib/sapMirror.ts → pullBusinessPartners). Cache
 * lecture seule côté app — la modification reste réservée à SAP B1.
 *
 * ⚠️ Cet agent N'EXÉCUTE PAS ce DDL (worktree isolé, pas de touch prod).
 *
 * Usage :
 *   node scripts/ddl-bp-credit.mjs           → dry-run (montre le DDL, n'écrit rien)
 *   node scripts/ddl-bp-credit.mjs --apply   → applique l'ALTER TABLE (idempotent)
 *
 * Bloc Prisma correspondant (schema.prisma, modèle SapBusinessPartner) :
 *   creditLimit           Float?
 *   currentAccountBalance Float?
 *   frozen                Boolean @default(false)
 */
import fs from "node:fs";
import path from "node:path";
import { PrismaClient } from "@prisma/client";

// ── env (.env puis .env.local, déséchappe \$) — modèle scripts/ddl-user-commercial.mjs ──
const env = {};
for (const f of [".env", ".env.local"]) {
  const p = path.resolve(process.cwd(), f);
  if (!fs.existsSync(p)) continue;
  for (const line of fs.readFileSync(p, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([\w.]+)\s*=\s*(.*)\s*$/); if (!m) continue;
    let v = m[2].trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    env[m[1]] = v.replace(/\\\$/g, "$");
  }
}
const g = (k) => process.env[k] ?? env[k] ?? "";

// Pool Supabase limité — 2 connexions max (cf. backfill-docs.mjs).
const dbUrl = (() => {
  const u = g("DATABASE_URL");
  if (!u) return undefined;
  const sep = u.includes("?") ? "&" : "?";
  return u.includes("connection_limit") ? u : `${u}${sep}connection_limit=2&pool_timeout=60`;
})();
const prisma = new PrismaClient(dbUrl ? { datasources: { db: { url: dbUrl } } } : undefined);

const APPLY = process.argv.includes("--apply");

const DDL = `
ALTER TABLE "SapBusinessPartner"
  ADD COLUMN IF NOT EXISTS "creditLimit" DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS "currentAccountBalance" DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS "frozen" BOOLEAN NOT NULL DEFAULT false;`;

async function main() {
  console.log(`Mode : ${APPLY ? "APPLY (écriture)" : "DRY-RUN (aucune écriture — relancer avec --apply)"}\n`);
  console.log("── DDL prévu ──");
  console.log(DDL.trim());

  if (!APPLY) {
    console.log("\nDRY-RUN terminé. Relancer avec --apply pour exécuter l'ALTER TABLE.");
    console.log("Après application : relancer une synchro BusinessPartners pour peupler les colonnes.");
    return;
  }

  await prisma.$executeRawUnsafe(DDL);
  console.log('\n✓ colonnes creditLimit / currentAccountBalance / frozen présentes sur "SapBusinessPartner"');
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
