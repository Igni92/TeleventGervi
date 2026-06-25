/**
 * DDL idempotent — Rôle préparateur gérable depuis l'UI.
 *
 * Ajoute la colonne "User"."isPreparateur" (BOOLEAN, défaut false). Un admin
 * peut alors désigner / retirer un « responsable stock » depuis la section
 * « Équipe » de l'écran Effectifs (/commerciaux), sans redéploiement.
 *
 * Le préparateur (= « personne en charge du stock ») peut valider, rouvrir et
 * corriger les inventaires (cf. lib/inventory.isPreparateur + /api/inventaire).
 *
 * Les emails de lib/inventory (DEFAULT_PREPARATEURS + PREPARATEUR_EMAILS) restent
 * préparateurs « bootstrap » indélogeables (cohérent avec le rôle admin).
 *
 * ⚠️ Colonne lue/écrite en $queryRawUnsafe (le client Prisma généré peut être
 *    en retard — EPERM dev server). Convention identique au reste du repo.
 *
 *   Usage : node scripts/ddl-user-ispreparateur.mjs
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
  console.log("══ DDL User.isPreparateur (rôle préparateur gérable en UI) ══\n");

  await prisma.$executeRawUnsafe(`
    ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "isPreparateur" BOOLEAN NOT NULL DEFAULT false;
  `);
  console.log('✅ Colonne "User"."isPreparateur" (BOOLEAN, défaut false)');

  // ── État final ──
  const [state] = await prisma.$queryRawUnsafe(`
    SELECT (SELECT COUNT(*) FROM "User")::int AS comptes,
           (SELECT COUNT(*) FROM "User" WHERE "isPreparateur" = true)::int AS preparateurs_db;
  `);
  console.log("\n📊 Comptes :", state, "(+ préparateurs bootstrap dans lib/inventory.ts)");
}

main()
  .catch((e) => { console.error("❌", e.message); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
