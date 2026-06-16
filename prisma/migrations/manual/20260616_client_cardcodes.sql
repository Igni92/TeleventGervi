-- Audit B5 — store canonique des CardCodes d'un client logique.
-- NON APPLIQUÉ automatiquement (cf. scripts/ddl-client-cardcodes.mjs --apply).
-- Idempotent : ré-exécutable sans effet de bord.

CREATE TABLE IF NOT EXISTS "ClientCardCode" (
  "id"        TEXT PRIMARY KEY,
  "clientId"  TEXT NOT NULL,
  "cardCode"  TEXT NOT NULL,
  "isPrimary" BOOLEAN NOT NULL DEFAULT false,
  "source"    TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS "ClientCardCode_cardCode_key" ON "ClientCardCode" ("cardCode");
CREATE INDEX IF NOT EXISTS "ClientCardCode_clientId_idx" ON "ClientCardCode" ("clientId");

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'ClientCardCode_clientId_fkey'
  ) THEN
    ALTER TABLE "ClientCardCode"
      ADD CONSTRAINT "ClientCardCode_clientId_fkey"
      FOREIGN KEY ("clientId") REFERENCES "Client"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- Backfill non destructif (ON CONFLICT DO NOTHING : un cardCode = un seul client).
INSERT INTO "ClientCardCode" ("id", "clientId", "cardCode", "isPrimary", "source", "createdAt")
SELECT gen_random_uuid()::text, c."id", c."code", true, 'principal', NOW()
FROM "Client" c
WHERE c."code" IS NOT NULL AND c."code" <> ''
ON CONFLICT ("cardCode") DO NOTHING;

INSERT INTO "ClientCardCode" ("id", "clientId", "cardCode", "isPrimary", "source", "createdAt")
SELECT DISTINCT gen_random_uuid()::text, dm."clientId", dm."sapCardCode", false, 'deliveryMode', NOW()
FROM "ClientDeliveryMode" dm
WHERE dm."sapCardCode" IS NOT NULL AND dm."sapCardCode" <> ''
ON CONFLICT ("cardCode") DO NOTHING;
