/**
 * Backfill — affecte à JMG (Jean-Michel Gunslay) tous les clients SANS commercial.
 *
 * Règle métier : un client sans commercial assigné revient par défaut à JMG
 * (il n'apparaît sinon dans la liste d'aucun commercial). Idempotent : ne touche
 * que les lignes où "commercial" est NULL ou vide.
 *
 *   Usage : node scripts/assign-unassigned-to-jmg.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { PrismaClient } from "@prisma/client";

const DEFAULT_COMMERCIAL = "JMG";

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
  console.log(`══ Affectation des clients sans commercial → ${DEFAULT_COMMERCIAL} ══\n`);

  const [before] = await prisma.$queryRawUnsafe(
    `SELECT COUNT(*)::int AS n FROM "Client" WHERE "commercial" IS NULL OR "commercial" = ''`,
  );
  console.log(`Clients sans commercial : ${before.n}`);

  const updated = await prisma.$executeRawUnsafe(
    `UPDATE "Client" SET "commercial" = $1, "updatedAt" = NOW()
     WHERE "commercial" IS NULL OR "commercial" = ''`,
    DEFAULT_COMMERCIAL,
  );
  console.log(`✅ ${updated} client(s) affecté(s) à ${DEFAULT_COMMERCIAL}`);
}

main()
  .catch((e) => { console.error("❌", e.message); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
