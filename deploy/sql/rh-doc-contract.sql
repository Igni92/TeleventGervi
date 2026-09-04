-- Additif : rattacher un document RH à un CONTRAT précis (pas seulement au
-- coffre-fort général du salarié). Colonne + index + FK (SET NULL à la
-- suppression du contrat → le document retombe dans le coffre-fort général).
-- Idempotent. À appliquer AVANT le déploiement du code qui écrit "contractId".

ALTER TABLE "RhDocument" ADD COLUMN IF NOT EXISTS "contractId" TEXT;

CREATE INDEX IF NOT EXISTS "RhDocument_contractId_idx" ON "RhDocument"("contractId");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'RhDocument_contractId_fkey'
  ) THEN
    ALTER TABLE "RhDocument"
      ADD CONSTRAINT "RhDocument_contractId_fkey"
      FOREIGN KEY ("contractId") REFERENCES "Contract"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
