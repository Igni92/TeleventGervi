/**
 * DDL idempotent — Localisation client (cache adresse SAP).
 *
 * Ajoute "city" / "zipCode" / "country" à la table "Client". Ces colonnes sont
 * alimentées par l'import SAP (/api/sap/clients/import → City/ZipCode/Country du
 * BusinessPartner) et servent à la carte « Où je livre le plus » (Écran 3 du
 * dashboard) : département FR déduit du code postal, pays pour l'export.
 *
 * ⚠️ Accédées en $queryRaw/$executeRaw (client Prisma possiblement en retard —
 *    EPERM dev server). Même convention que activeTelevente / CommercialObjectif.
 *
 *   Usage : node scripts/ddl-client-geo.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { PrismaClient } from "@prisma/client";

// ── env (.env puis .env.local, déséchappe \$) — modèle ddl-commercial-objectif ──
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
  console.log("══ DDL Client géo (city / zipCode / country) ══\n");

  await prisma.$executeRawUnsafe(`ALTER TABLE "Client" ADD COLUMN IF NOT EXISTS "city" TEXT;`);
  await prisma.$executeRawUnsafe(`ALTER TABLE "Client" ADD COLUMN IF NOT EXISTS "zipCode" TEXT;`);
  await prisma.$executeRawUnsafe(`ALTER TABLE "Client" ADD COLUMN IF NOT EXISTS "country" TEXT;`);
  console.log('✅ Colonnes "city" / "zipCode" / "country" sur "Client"');

  const [state] = await prisma.$queryRawUnsafe(`
    SELECT COUNT(*)::int AS total,
           COUNT("zipCode")::int AS with_zip,
           COUNT("country")::int AS with_country
    FROM "Client";
  `);
  console.log("\n📊 Clients :", state, "\n→ relancer l'import SAP clients pour peupler ces colonnes.");
}

main()
  .catch((e) => { console.error("❌", e.message); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
