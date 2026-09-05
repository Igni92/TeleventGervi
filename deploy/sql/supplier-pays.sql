-- Additif : pays du fournisseur. Idempotent. À appliquer AVANT le déploiement
-- du code qui lit/écrit "pays".
ALTER TABLE "Supplier" ADD COLUMN IF NOT EXISTS "pays" TEXT;
