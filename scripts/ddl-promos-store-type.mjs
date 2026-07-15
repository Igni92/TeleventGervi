/**
 * DDL idempotent — Promotions : ciblage par TYPE DE MAGASIN + tarif imposé.
 *
 * Ce script ajoute `storeType` à "Promo" : la promo ne s'applique alors qu'aux
 * MAGASINS de ce type (Client.type = EXPORT | GMS | CHR). NULL = tous.
 *
 * Il n'y a PAS de nouvelle colonne pour le prix imposé (kind='PRICE') : on
 * réutilise `value` (déjà présent), qui porte le PRIX UNITAIRE fixe au lieu du
 * pourcentage de remise. C'est le `kind` qui distingue les deux usages.
 *
 * ⚠️ Cette colonne est accédée en $queryRawUnsafe/$executeRawUnsafe uniquement
 *    (le client Prisma généré ne la connaît pas — EPERM dev server), comme
 *    `pitch` (cf. scripts/ddl-promos-v2.mjs).
 *
 *   Usage : node scripts/ddl-promos-store-type.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { PrismaClient } from "@prisma/client";

// ── env (.env puis .env.local, déséchappe \$) — modèle ddl-promos-v2.mjs ──
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
const dbUrl = (() => {
  const u = process.env.DATABASE_URL ?? env.DATABASE_URL;
  if (!u) throw new Error("DATABASE_URL introuvable (.env/.env.local)");
  const sep = u.includes("?") ? "&" : "?";
  return u.includes("connection_limit") ? u : `${u}${sep}connection_limit=2&pool_timeout=60`;
})();
const prisma = new PrismaClient({ datasources: { db: { url: dbUrl } } });

async function main() {
  console.log("══ DDL Promo.storeType ══\n");

  // ── storeType sur Promo ────────────────────────────────────────────
  await prisma.$executeRawUnsafe(`
    ALTER TABLE "Promo"
      ADD COLUMN IF NOT EXISTS "storeType" TEXT;
  `);
  console.log('✅ Promo."storeType" (TEXT, nullable — EXPORT | GMS | CHR | NULL=tous)');

  // Index partiel : accélère le filtrage « promos d'un type de magasin ».
  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS "Promo_storeType_idx" ON "Promo" ("storeType");
  `);
  console.log('✅ Index Promo."storeType"');

  // ── État final ──────────────────────────────────────────────────────
  const [state] = await prisma.$queryRawUnsafe(`
    SELECT (SELECT COUNT(*) FROM "Promo")::int                                AS promos,
           (SELECT COUNT(*) FROM "Promo" WHERE "storeType" IS NOT NULL)::int  AS ciblees,
           (SELECT COUNT(*) FROM "Promo" WHERE "kind" = 'PRICE')::int         AS tarifs;
  `);
  console.log("\n📊 État :", state);
}

main()
  .catch((e) => { console.error("❌", e.message); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
