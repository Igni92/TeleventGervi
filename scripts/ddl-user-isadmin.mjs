/**
 * DDL idempotent — Rôle admin gérable depuis l'UI.
 *
 * Ajoute la colonne "User"."isAdmin" (BOOLEAN, défaut false). Un admin peut
 * alors promouvoir/rétrograder un autre commercial depuis la section
 * « Équipe TeleVent » (/commerciaux), sans redéploiement.
 *
 * Les emails de lib/permissions.ts (ADMIN_EMAILS) restent admins « bootstrap »
 * indélogeables (sécurité : on ne peut jamais se verrouiller dehors).
 *
 * ⚠️ Colonne lue/écrite en $queryRawUnsafe (le client Prisma généré peut être
 *    en retard — EPERM dev server). Convention identique au reste du repo.
 *
 *   Usage : node scripts/ddl-user-isadmin.mjs
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
  console.log("══ DDL User.isAdmin (rôle admin gérable en UI) ══\n");

  await prisma.$executeRawUnsafe(`
    ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "isAdmin" BOOLEAN NOT NULL DEFAULT false;
  `);
  console.log('✅ Colonne "User"."isAdmin" (BOOLEAN, défaut false)');

  // ── État final ──
  const [state] = await prisma.$queryRawUnsafe(`
    SELECT (SELECT COUNT(*) FROM "User")::int AS comptes,
           (SELECT COUNT(*) FROM "User" WHERE "isAdmin" = true)::int AS admins_db;
  `);
  console.log("\n📊 Comptes :", state, "(+ admins bootstrap dans lib/permissions.ts)");
}

main()
  .catch((e) => { console.error("❌", e.message); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
