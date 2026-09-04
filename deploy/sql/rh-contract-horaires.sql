-- Additif : horaires prévus + modulation saisonnière par contrat (JSON).
-- null → horaire par défaut dérivé de heuresHebdo. Idempotent. À appliquer AVANT
-- le déploiement du code qui lit/écrit "horairesJson".
ALTER TABLE "Contract" ADD COLUMN IF NOT EXISTS "horairesJson" TEXT;
