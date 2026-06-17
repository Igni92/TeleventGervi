-- ─────────────────────────────────────────────────────────────────────────
-- Champs de risque crédit sur le miroir "SapBusinessPartner".
--   creditLimit           = SAP BusinessPartners.CreditLimit (plafond autorisé)
--   currentAccountBalance = SAP BusinessPartners.CurrentAccountBalance (solde dû)
--   frozen                = SAP BusinessPartners.Frozen ('tYES'/'tNO' → bool)
--
-- Peuplés par lib/sapMirror.ts (pullBusinessPartners). Cache lecture seule côté
-- app — modification réservée à SAP B1.
--
-- Idempotent (ADD COLUMN IF NOT EXISTS). Déjà appliqué sur la base de test.
-- En prod :  psql "$DATABASE_URL" -f prisma/migrations/manual/20260617_sap_bp_credit.sql
-- Puis relancer une synchro BP (resync) pour peupler les valeurs.
-- ─────────────────────────────────────────────────────────────────────────

ALTER TABLE "SapBusinessPartner"
  ADD COLUMN IF NOT EXISTS "creditLimit" DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS "currentAccountBalance" DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS "frozen" BOOLEAN NOT NULL DEFAULT false;
