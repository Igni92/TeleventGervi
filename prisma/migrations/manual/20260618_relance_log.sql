-- ─────────────────────────────────────────────────────────────────────────
-- Journalisation des relances de recouvrement — NT-2026-RC-01 (§6).
--
-- Table "RelanceLog" : 1 ligne par courrier de relance émis (R0→R5). Piste
-- d'audit horodatée (tiers, niveau, canal, destinataire, décompte) — preuve des
-- diligences en cas de contentieux.
--
-- Idempotent (CREATE TABLE / ADD COLUMN IF NOT EXISTS). Additif : ne touche
-- aucune donnée existante.
--   En prod :  psql "$DATABASE_URL" -f prisma/migrations/manual/20260618_relance_log.sql
--   (ou via Supabase MCP apply_migration). Côté client local : prisma generate.
-- ─────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "RelanceLog" (
  "id"               TEXT NOT NULL,
  "cardCode"         TEXT NOT NULL,
  "clientId"         TEXT,
  "level"            TEXT NOT NULL,
  "channel"          TEXT NOT NULL,
  "subject"          TEXT NOT NULL,
  "recipient"        TEXT NOT NULL,
  "intendedTo"       TEXT,
  "testMode"         BOOLEAN NOT NULL DEFAULT true,
  "docEntries"       INTEGER[] NOT NULL DEFAULT '{}'::integer[],
  "docNums"          TEXT,
  "montantPrincipal" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "montantPenalites" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "montantIfr"       DOUBLE PRECISION NOT NULL DEFAULT 0,
  "montantTotal"     DOUBLE PRECISION NOT NULL DEFAULT 0,
  "status"           TEXT NOT NULL DEFAULT 'ENVOYE',
  "error"            TEXT,
  "msMessageId"      TEXT,
  "sentBy"           TEXT,
  "sentAt"           TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "RelanceLog_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "RelanceLog_cardCode_idx" ON "RelanceLog" ("cardCode");
CREATE INDEX IF NOT EXISTS "RelanceLog_clientId_idx" ON "RelanceLog" ("clientId");
CREATE INDEX IF NOT EXISTS "RelanceLog_level_idx"    ON "RelanceLog" ("level");
CREATE INDEX IF NOT EXISTS "RelanceLog_sentAt_idx"   ON "RelanceLog" ("sentAt");
