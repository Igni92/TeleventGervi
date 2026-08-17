-- ─────────────────────────────────────────────────────────────────────────
-- Archive documents : pivot de DOSSIER (BL → Facture → Avoir).
-- Colonne "invoiceEntry" = DocEntry de la facture centrale, précalculé (liens
-- SAP BaseType 17/13) → le « dossier lié » devient un lookup local instantané.
-- Idempotent, additif.
--   psql "$DATABASE_URL" -f prisma/migrations/manual/20260817_document_archive_invoiceentry.sql
-- ─────────────────────────────────────────────────────────────────────────

ALTER TABLE "ArchivedDocument" ADD COLUMN IF NOT EXISTS "invoiceEntry" INTEGER;
CREATE INDEX IF NOT EXISTS "ArchivedDocument_invoiceEntry_idx" ON "ArchivedDocument" ("invoiceEntry");
