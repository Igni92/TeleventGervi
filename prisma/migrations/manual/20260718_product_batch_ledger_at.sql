-- ─────────────────────────────────────────────────────────────────────────
-- Registre des lots — horodatage du dernier MOUVEMENT (crédit/débit).
--
--   "ProductBatch"."ledgerAt" = posé par lib/lotLedger (creditLots/debitLots)
--   à chaque mouvement réel du registre. Distinct de "syncedAt" (touché par la
--   synchro produits toutes les 30 min, donc inutilisable comme signal de
--   fraîcheur d'un mouvement).
--
-- Sert de GARDE ANTI-COURSE à l'écrêtage du registre au stock physique
-- (reconcileLedgerToPhysical) : un article dont un lot a bougé il y a moins
-- d'une heure n'est pas écrêté à ce passage (le miroir ProductStock peut être
-- en retard sur une réception/vente en cours).
--
-- Idempotent (ADD COLUMN IF NOT EXISTS). Additif : aucune donnée touchée.
-- En prod :  psql "$DATABASE_URL" -f prisma/migrations/manual/20260718_product_batch_ledger_at.sql
--   (ou via Supabase MCP apply_migration). Côté client local : prisma generate.
-- ─────────────────────────────────────────────────────────────────────────

ALTER TABLE "ProductBatch" ADD COLUMN IF NOT EXISTS "ledgerAt" TIMESTAMP(3);
