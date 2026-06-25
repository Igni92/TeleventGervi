/**
 * DDL idempotent — Rôle commercial gérable depuis l'UI (système de rôles).
 *
 * Ajoute la colonne "User"."isCommercial" (BOOLEAN, défaut true). Les rôles
 * (Commercial / Préparateur / Admin) sont INDÉPENDANTS et cumulables, gérés
 * depuis la section « Équipe » de l'écran Effectifs (/commerciaux).
 *
 * Défaut true : tout compte est commercial tant qu'on ne lui retire pas le rôle.
 *
 * ⚠️ Colonne lue/écrite en $queryRawUnsafe (le client Prisma généré peut être
 *    en retard — EPERM dev server). Convention identique au reste du repo
 *    (cf. ddl-user-isadmin.mjs, ddl-user-ispreparateur.mjs).
 *
 *   Usage : node scripts/ddl-user-roles.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { PrismaClient } from "@prisma/client";

// ── env (.env puis .env.local, déséchappe \$) — modèle ddl-user-isadmin.mjs ──
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
  console.log("══ DDL User.isCommercial (rôle commercial gérable en UI) ══\n");

  await prisma.$executeRawUnsafe(`
    ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "isCommercial" BOOLEAN NOT NULL DEFAULT true;
  `);
  console.log('✅ Colonne "User"."isCommercial" (BOOLEAN, défaut true)');

  // ── État final ──
  const [state] = await prisma.$queryRawUnsafe(`
    SELECT (SELECT COUNT(*) FROM "User")::int AS comptes,
           (SELECT COUNT(*) FROM "User" WHERE "isCommercial" = true)::int AS commerciaux,
           (SELECT COUNT(*) FROM "User" WHERE "isPreparateur" = true)::int AS preparateurs,
           (SELECT COUNT(*) FROM "User" WHERE "isAdmin" = true)::int AS admins;
  `);
  console.log("\n📊 Rôles :", state, "(+ bootstrap code/env)");
}

main()
  .catch((e) => { console.error("❌", e.message); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
