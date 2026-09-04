/**
 * DDL idempotent — Langue de communication par client.
 *
 * Ajoute "langue" (TEXT, défaut 'FR') à la table "Client". Détermine la langue
 * des courriers générés (relance, cotation…) : FR | EN | AR. Défaut 'FR' =
 * comportement inchangé pour tous les clients existants.
 *
 * ⚠️ Accédée en $queryRaw/$executeRaw côté app (client Prisma possiblement en
 *    retard). Même convention que relanceActive / activeTelevente / city.
 *
 *   Usage : node scripts/ddl-client-langue.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { PrismaClient } from "@prisma/client";

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
  console.log("══ DDL Client langue ══\n");
  await prisma.$executeRawUnsafe(
    `ALTER TABLE "Client" ADD COLUMN IF NOT EXISTS "langue" TEXT NOT NULL DEFAULT 'FR';`,
  );
  console.log('✅ Colonne "langue" sur "Client" (défaut FR)');

  const rows = await prisma.$queryRawUnsafe(`
    SELECT "langue", COUNT(*)::int AS n FROM "Client" GROUP BY "langue" ORDER BY 1;
  `);
  console.log("\n📊 Répartition des langues :", rows);
}

main()
  .catch((e) => { console.error("❌", e.message); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
