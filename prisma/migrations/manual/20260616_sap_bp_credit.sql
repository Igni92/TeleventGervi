-- ─────────────────────────────────────────────────────────────────────────
-- Migration MANUELLE — NON APPLIQUÉE par cet agent (worktree isolé).
-- Ajoute les champs de risque crédit au miroir SapBusinessPartner :
--   creditLimit           = SAP BusinessPartners.CreditLimit (plafond autorisé)
--   currentAccountBalance = SAP BusinessPartners.CurrentAccountBalance (solde dû)
--   frozen                = SAP BusinessPartners.Frozen ('tYES'/'tNO' → bool)
--
-- Idempotent (ADD COLUMN IF NOT EXISTS). À exécuter en prod par un opérateur :
--   psql "$DATABASE_URL" -f prisma/migrations/manual/20260616_sap_bp_credit.sql
-- ou via : node scripts/ddl-bp-credit.mjs --apply
-- ─────────────────────────────────────────────────────────────────────────

ALTER TABLE "SapBusinessPartner"
  ADD COLUMN IF NOT EXISTS "creditLimit" DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS "currentAccountBalance" DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS "frozen" BOOLEAN NOT NULL DEFAULT false;
