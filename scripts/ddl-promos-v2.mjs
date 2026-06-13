/**
 * DDL idempotent — Promotions v2 (bandeau vendeur + notifications).
 *
 * Ce script :
 *   1. Ajoute `pitch` à "Promo" (argumentaire commercial court affiché
 *      dans le bandeau PromoBanner et la modale de notifications).
 *   2. Crée "PromoSeen" (consultation des promos par utilisateur —
 *      alimente le badge « NOUVEAU » et GET /api/notifications).
 *
 * ⚠️ Ces tables/colonnes sont accédées en $queryRawUnsafe/$executeRawUnsafe
 *    uniquement (le client Prisma généré ne les connaît pas — EPERM dev server).
 *
 *   Usage : node scripts/ddl-promos-v2.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { PrismaClient } from "@prisma/client";

// ── env (.env puis .env.local, déséchappe \$) — modèle backfill-docs.mjs ──
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
  console.log("══ DDL Promotions v2 ══\n");

  // ── 1. pitch sur Promo ─────────────────────────────────────────────
  await prisma.$executeRawUnsafe(`
    ALTER TABLE "Promo"
      ADD COLUMN IF NOT EXISTS "pitch" TEXT;
  `);
  console.log('✅ Promo."pitch" (TEXT, nullable)');

  // ── 2. PromoSeen — consultation par utilisateur ────────────────────
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "PromoSeen" (
      "userId"  TEXT NOT NULL,
      "promoId" TEXT NOT NULL REFERENCES "Promo"("id") ON DELETE CASCADE,
      "seenAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "PromoSeen_pkey" PRIMARY KEY ("userId", "promoId")
    );
  `);
  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS "PromoSeen_promoId_idx" ON "PromoSeen" ("promoId");
  `);
  console.log("✅ PromoSeen (PK userId+promoId, FK Promo ON DELETE CASCADE, index promoId)");

  // ── 3. État final ──────────────────────────────────────────────────
  const [state] = await prisma.$queryRawUnsafe(`
    SELECT (SELECT COUNT(*) FROM "Promo")::int                          AS promos,
           (SELECT COUNT(*) FROM "Promo" WHERE "pitch" IS NOT NULL)::int AS avec_pitch,
           (SELECT COUNT(*) FROM "PromoSeen")::int                      AS vues;
  `);
  console.log("\n📊 État :", state);
}

main()
  .catch((e) => { console.error("❌", e.message); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
