-- ─────────────────────────────────────────────────────────────────────────
-- Fabrication — conservation du lot du composant (traçabilité EM).
--
-- « ProductionRecipe.conserveLot » : quand true, le produit fini HÉRITE du lot
-- EM du composant principal (au lieu d'un code OP synthétique). Pertinent pour
-- les transformés « 1 fruit → 1 forme » (ex. Kiwi épluché ← Kiwi).
--
-- « FabricationRun.parentBatch » : lot réel du produit fini au moment du run
-- (« EM<DocNum> » hérité, ou le code OP) — sert au sélecteur de lots à proposer
-- ce lot pour un produit fabriqué (qui n'a aucune entrée marchandise à lui).
--
-- Idempotent (ADD COLUMN / CREATE INDEX IF NOT EXISTS). Additif : ne touche
-- aucune donnée existante (valeurs par défaut = comportement inchangé).
--   En prod :  psql "$DATABASE_URL" -f prisma/migrations/manual/20260713_fabrication_conserve_lot.sql
--   (ou via Supabase MCP apply_migration). Côté client local : prisma generate.
-- ─────────────────────────────────────────────────────────────────────────

ALTER TABLE "ProductionRecipe" ADD COLUMN IF NOT EXISTS "conserveLot" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "FabricationRun" ADD COLUMN IF NOT EXISTS "parentBatch" TEXT;

CREATE INDEX IF NOT EXISTS "FabricationRun_parentItemCode_createdAt_idx"
  ON "FabricationRun" ("parentItemCode", "createdAt");
