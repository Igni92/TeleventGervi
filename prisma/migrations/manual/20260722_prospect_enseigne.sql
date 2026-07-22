-- Prospection : code ENSEIGNE homogène + format (Hyper/Super) pour le tri du
-- vivier. Additif, idempotent (colonnes lues en $queryRawUnsafe côté app).
ALTER TABLE "Client" ADD COLUMN IF NOT EXISTS "prospectEnseigne" TEXT;  -- A | ITM | U | L | CARR | MONO | … | AUTRE
ALTER TABLE "Client" ADD COLUMN IF NOT EXISTS "prospectFormat"   TEXT;  -- Hyper | Super | …

CREATE INDEX IF NOT EXISTS "Client_prospectEnseigne_idx" ON "Client" ("prospectEnseigne");
