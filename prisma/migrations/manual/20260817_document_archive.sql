-- ─────────────────────────────────────────────────────────────────────────
-- Archive des PDF clients (BL, avoirs, factures) — boîte factures-archive@.
--
-- Table "ArchivedDocument" : 1 ligne par pièce jointe PDF récupérée de la boîte
-- partagée. Le FICHIER vit sur le VPS (storage/archive/…) ; cette table en est
-- l'INDEX (recherche rapide par client + type). Rattachement au client via le
-- n° de document lu dans le nom/objet, résolu sur le miroir SAP.
--
-- Idempotent (IF NOT EXISTS). Additif : ne touche aucune donnée existante.
--   En prod :  psql "$DATABASE_URL" -f prisma/migrations/manual/20260817_document_archive.sql
--   (ou via Supabase MCP apply_migration). Côté client local : prisma generate.
-- ─────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "ArchivedDocument" (
  "id"                TEXT NOT NULL,
  "docType"           TEXT NOT NULL,
  "docNum"            TEXT,
  "docEntry"          INTEGER,
  "cardCode"          TEXT,
  "clientId"          TEXT,
  "docDate"           TIMESTAMP(3),
  "matched"           BOOLEAN NOT NULL DEFAULT false,
  "fileName"          TEXT NOT NULL,
  "filePath"          TEXT NOT NULL,
  "sizeBytes"         INTEGER NOT NULL DEFAULT 0,
  "graphMessageId"    TEXT NOT NULL,
  "graphAttachmentId" TEXT NOT NULL,
  "mailSubject"       TEXT,
  "receivedAt"        TIMESTAMP(3) NOT NULL,
  "lastSentAt"        TIMESTAMP(3),
  "lastSentTo"        TEXT,
  "createdAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ArchivedDocument_pkey" PRIMARY KEY ("id")
);

-- Déduplication de la source Graph (un même attachment n'est indexé qu'une fois).
CREATE UNIQUE INDEX IF NOT EXISTS "ArchivedDocument_graph_key"
  ON "ArchivedDocument" ("graphMessageId", "graphAttachmentId");

CREATE INDEX IF NOT EXISTS "ArchivedDocument_client_type_idx" ON "ArchivedDocument" ("clientId", "docType");
CREATE INDEX IF NOT EXISTS "ArchivedDocument_card_type_idx"   ON "ArchivedDocument" ("cardCode", "docType");
CREATE INDEX IF NOT EXISTS "ArchivedDocument_type_num_idx"    ON "ArchivedDocument" ("docType", "docNum");
CREATE INDEX IF NOT EXISTS "ArchivedDocument_receivedAt_idx"  ON "ArchivedDocument" ("receivedAt");

-- FK client (SET NULL : on garde le PDF même si la fiche client disparaît).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ArchivedDocument_clientId_fkey'
  ) THEN
    ALTER TABLE "ArchivedDocument"
      ADD CONSTRAINT "ArchivedDocument_clientId_fkey"
      FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
