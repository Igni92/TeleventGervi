/**
 * DDL idempotent — Logos de marques.
 *
 * Table "BrandLogo" : marque (PK, = Product.uMarque) → logoUrl (data-URL base64
 * d'un logo redimensionné). Partagée pour tous les postes ; le logo s'affiche
 * dans la console (liste stock), entre le stock et la désignation du produit.
 *
 * ⚠️ Accédée en $queryRawUnsafe/$executeRawUnsafe (convention repo). Gérée via la
 *    page Paramètres « Marques & logos » (/parametres/marques).
 *
 *   Usage : node scripts/ddl-brand-logos.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { PrismaClient } from "@prisma/client";

// ── env (.env puis .env.local, déséchappe \$) ──
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
  console.log("══ DDL BrandLogo (logos de marques) ══\n");
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "BrandLogo" (
      "marque"    text PRIMARY KEY,
      "logoUrl"   text NOT NULL,
      "updatedAt" timestamptz NOT NULL DEFAULT now()
    );
  `);
  const [{ count }] = await prisma.$queryRawUnsafe(`SELECT count(*)::int AS count FROM "BrandLogo"`);
  console.log(`✓ Table "BrandLogo" prête (${count} logo(s)).`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
