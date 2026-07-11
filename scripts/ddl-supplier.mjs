/**
 * DDL idempotent — Fiches FOURNISSEURS (distinction client / fournisseur).
 *
 * Crée les tables "Supplier" (fiche fournisseur) et "SupplierContact" (ses
 * interlocuteurs, miroir de "Contact" côté client). Additif : ne touche aucune
 * donnée existante. Applique le même contenu que
 * prisma/migrations/manual/20260711_supplier.sql.
 *
 *   Usage : node scripts/ddl-supplier.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { PrismaClient } from "@prisma/client";

// ── env (.env puis .env.local, déséchappe \$) — modèle ddl-client-geo ──
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
  console.log("══ DDL Fournisseurs (Supplier / SupplierContact) ══\n");

  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "Supplier" (
      "id"          TEXT NOT NULL,
      "code"        TEXT NOT NULL,
      "nom"         TEXT NOT NULL,
      "type"        TEXT,
      "sapCardCode" TEXT,
      "email"       TEXT,
      "tel1"        TEXT,
      "tel2"        TEXT,
      "tel3"        TEXT,
      "adresse"     TEXT,
      "notes"       TEXT,
      "active"      BOOLEAN NOT NULL DEFAULT true,
      "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "Supplier_pkey" PRIMARY KEY ("id")
    );
  `);
  await prisma.$executeRawUnsafe(`CREATE UNIQUE INDEX IF NOT EXISTS "Supplier_code_key" ON "Supplier" ("code");`);
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "Supplier_sapCardCode_idx" ON "Supplier" ("sapCardCode");`);
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "Supplier_active_idx" ON "Supplier" ("active");`);
  console.log('✅ Table "Supplier"');

  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "SupplierContact" (
      "id"         TEXT NOT NULL,
      "supplierId" TEXT NOT NULL,
      "name"       TEXT NOT NULL,
      "role"       TEXT,
      "phone"      TEXT,
      "email"      TEXT,
      "note"       TEXT,
      "position"   INTEGER NOT NULL DEFAULT 0,
      "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "SupplierContact_pkey" PRIMARY KEY ("id")
    );
  `);
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "SupplierContact_supplierId_idx" ON "SupplierContact" ("supplierId");`);
  await prisma.$executeRawUnsafe(`
    DO $$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'SupplierContact_supplierId_fkey') THEN
        ALTER TABLE "SupplierContact"
          ADD CONSTRAINT "SupplierContact_supplierId_fkey"
          FOREIGN KEY ("supplierId") REFERENCES "Supplier" ("id")
          ON DELETE CASCADE ON UPDATE CASCADE;
      END IF;
    END $$;
  `);
  console.log('✅ Table "SupplierContact" (+ FK cascade)');

  const [state] = await prisma.$queryRawUnsafe(`SELECT COUNT(*)::int AS total FROM "Supplier";`);
  console.log("\n📊 Fournisseurs :", state);
}

main()
  .catch((e) => { console.error("❌", e.message); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
