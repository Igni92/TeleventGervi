-- Additif : annualisation du temps de travail activable par contrat.
-- Défaut true (comportement inchangé). Idempotent. À appliquer AVANT le
-- déploiement du code qui lit/écrit "annualise".
ALTER TABLE "Contract" ADD COLUMN IF NOT EXISTS "annualise" BOOLEAN NOT NULL DEFAULT true;
