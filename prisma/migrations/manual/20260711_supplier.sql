-- ─────────────────────────────────────────────────────────────────────────
-- Fiches FOURNISSEURS (distinction client / fournisseur).
--
-- Le CLIENT est le tiers de VENTE (télévente) ; le FOURNISSEUR le tiers d'ACHAT.
-- SAP reste la source de vérité des tiers (BusinessPartner cardType=V) — cette
-- fiche est le miroir humain « achats » : on y renseigne les INTERLOCUTEURS et
-- les notes. `sapCardCode` relie (facultativement) la fiche au fournisseur SAP.
--
--   "Supplier"        : la fiche fournisseur (1 ligne par fournisseur).
--   "SupplierContact" : ses interlocuteurs (miroir de "Contact" côté client).
--
-- Idempotent (CREATE TABLE / INDEX IF NOT EXISTS). Additif : ne touche aucune
-- donnée existante.
--   En prod :  psql "$DATABASE_URL" -f prisma/migrations/manual/20260711_supplier.sql
--   (ou via Supabase MCP apply_migration). Côté client local : prisma generate.
-- ─────────────────────────────────────────────────────────────────────────

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

CREATE UNIQUE INDEX IF NOT EXISTS "Supplier_code_key"        ON "Supplier" ("code");
CREATE INDEX        IF NOT EXISTS "Supplier_sapCardCode_idx" ON "Supplier" ("sapCardCode");
CREATE INDEX        IF NOT EXISTS "Supplier_active_idx"      ON "Supplier" ("active");

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

CREATE INDEX IF NOT EXISTS "SupplierContact_supplierId_idx" ON "SupplierContact" ("supplierId");

-- FK vers Supplier (cascade delete) — ajoutée seulement si absente.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'SupplierContact_supplierId_fkey'
  ) THEN
    ALTER TABLE "SupplierContact"
      ADD CONSTRAINT "SupplierContact_supplierId_fkey"
      FOREIGN KEY ("supplierId") REFERENCES "Supplier" ("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
