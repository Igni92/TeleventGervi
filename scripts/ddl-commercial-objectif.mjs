/**
 * DDL idempotent — Objectifs commerciaux (CA cible annuel par commercial).
 *
 * Table "CommercialObjectif" : slpName (trigramme) → objectifCa (€ annuel).
 * Le réalisé est mesuré sur le PORTEFEUILLE du commercial (clients affectés,
 * Client.commercial = slpName) — cf. /api/commerciaux/sap.
 *
 * ⚠️ Accédée en $queryRawUnsafe/$executeRawUnsafe (client Prisma possiblement
 *    en retard — EPERM dev server). Convention identique au repo.
 *
 *   Usage : node scripts/ddl-commercial-objectif.mjs
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
  console.log("══ DDL CommercialObjectif (objectifs CA par commercial) ══\n");

  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "CommercialObjectif" (
      "slpName"    TEXT PRIMARY KEY,
      "objectifCa" DOUBLE PRECISION NOT NULL DEFAULT 0,
      "updatedAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);
  console.log('✅ Table "CommercialObjectif" (slpName → objectifCa)');

  const [state] = await prisma.$queryRawUnsafe(`
    SELECT COUNT(*)::int AS objectifs FROM "CommercialObjectif";
  `);
  console.log("\n📊 Objectifs définis :", state);
}

main()
  .catch((e) => { console.error("❌", e.message); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
