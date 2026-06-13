/**
 * DDL idempotent — Favoris GROUPES d'articles (extension du système favoris).
 *
 * Crée la table "FavoriteGroup" : un commercial peut épingler un groupe
 * famille entier (groupName de Product) en tête de la liste stock Écran 2,
 * en plus des favoris articles ("FavoriteItem").
 *
 * ⚠️ Table accédée en $queryRawUnsafe/$executeRawUnsafe uniquement
 *    (le client Prisma généré ne la connaît pas — régénération impossible,
 *    EPERM dev server). Convention identique à app/api/favorites/route.ts.
 *
 *   Usage : node scripts/ddl-favorite-groups.mjs
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
  console.log("══ DDL FavoriteGroup (favoris groupes d'articles) ══\n");

  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "FavoriteGroup" (
      "id"        TEXT PRIMARY KEY,
      "userId"    TEXT NOT NULL,
      "groupName" TEXT NOT NULL,
      "position"  INTEGER NOT NULL DEFAULT 0,
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "FavoriteGroup_userId_groupName_key" UNIQUE ("userId", "groupName")
    );
  `);
  console.log('✅ Table "FavoriteGroup" (UNIQUE userId+groupName)');

  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS "FavoriteGroup_userId_idx" ON "FavoriteGroup" ("userId");
  `);
  console.log('✅ Index "FavoriteGroup_userId_idx"');

  // ── État final ──
  const [state] = await prisma.$queryRawUnsafe(`
    SELECT (SELECT COUNT(*) FROM "FavoriteGroup")::int AS groupes,
           (SELECT COUNT(*) FROM "FavoriteItem")::int  AS articles;
  `);
  console.log("\n📊 Favoris en base :", state);
}

main()
  .catch((e) => { console.error("❌", e.message); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
