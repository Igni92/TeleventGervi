-- ─────────────────────────────────────────────────────────────────────────
-- MODULE PROSPECTION (CRM) — pipeline commercial + rendez-vous + activité.
--
-- Sépare CLIENTS (commande < 1 an) et PROSPECTS (en pipeline ou sans commande
-- depuis > 1 an). Un prospect travaillé par un commercial lui reste rattaché
-- (Client.prospectOwner = son trigramme slpName) et bascule en client à la 2e
-- commande (étape GAGNE).
--
--   • Colonnes "Client" : étape de pipeline, propriétaire, source, proba labo…
--   • Table "RendezVous"          : agenda (R1 physique, appels), notif N min avant.
--   • Table "ProspectionActivity" : timeline (appel, mail, RDV, note, changement d'étape).
--
-- Idempotent (IF NOT EXISTS). Additif : ne touche AUCUNE donnée existante.
-- Nouvelles colonnes lues côté app en $queryRawUnsafe tant que `prisma generate`
-- reste bloqué (même convention que activeTelevente / vendeur).
-- RLS activé deny-all (cohérent avec les autres tables — Prisma bypass via le
-- rôle de service ; PostgREST anon/authenticated bloqué).
--   En prod :  psql "$DATABASE_URL" -f prisma/migrations/manual/20260721_prospection_pipeline.sql
--   (ou via Supabase MCP apply_migration). Côté client local : prisma generate.
-- ─────────────────────────────────────────────────────────────────────────

-- 1) Pipeline de prospection sur la fiche client.
--    prospectStage NULL = pas dans le pipeline (client normal ou non travaillé).
--    Étapes : A_CONTACTER | QUALIFICATION | PRESENTATION | POST_COMMANDE | GAGNE | PERDU
ALTER TABLE "Client" ADD COLUMN IF NOT EXISTS "prospectStage"      TEXT;
ALTER TABLE "Client" ADD COLUMN IF NOT EXISTS "prospectStageAt"    TIMESTAMP(3);
ALTER TABLE "Client" ADD COLUMN IF NOT EXISTS "prospectOwner"      TEXT;   -- slpName du commercial prospecteur
ALTER TABLE "Client" ADD COLUMN IF NOT EXISTS "prospectSource"     TEXT;   -- ex. "import-gms-idf-patisserie"
ALTER TABLE "Client" ADD COLUMN IF NOT EXISTS "prospectLostReason" TEXT;   -- motif si PERDU
ALTER TABLE "Client" ADD COLUMN IF NOT EXISTS "probaLabo"          TEXT;   -- Élevée | Moyenne-haute | Moyenne | À qualifier
ALTER TABLE "Client" ADD COLUMN IF NOT EXISTS "qualifieLabo"       BOOLEAN;-- résultat de la qualification (labo pâtisserie ?)

CREATE INDEX IF NOT EXISTS "Client_prospectStage_idx"  ON "Client" ("prospectStage");
CREATE INDEX IF NOT EXISTS "Client_prospectOwner_idx"  ON "Client" ("prospectOwner");

-- 2) Rendez-vous (agenda prospection) — R1 physique, appels programmés.
--    notifyMinutesBefore : délai de la notif push (défaut 60 = 1 h avant, MODIFIABLE).
--    notifiedAt : anti-doublon d'envoi (même logique que Rappel.notifiedAt).
CREATE TABLE IF NOT EXISTS "RendezVous" (
  "id"                 TEXT NOT NULL,
  "clientId"           TEXT NOT NULL,
  "ownerSlp"           TEXT,                                   -- trigramme du commercial
  "title"              TEXT NOT NULL,
  "type"               TEXT NOT NULL DEFAULT 'R1_PHYSIQUE',    -- R1_PHYSIQUE | APPEL | AUTRE
  "startAt"            TIMESTAMP(3) NOT NULL,
  "endAt"              TIMESTAMP(3),
  "location"           TEXT,
  "notes"              TEXT,
  "notifyMinutesBefore" INTEGER NOT NULL DEFAULT 60,           -- 1 h avant par défaut, réglable
  "notifiedAt"         TIMESTAMP(3),                           -- push envoyé (anti-doublon)
  "status"             TEXT NOT NULL DEFAULT 'PLANIFIE',       -- PLANIFIE | FAIT | ANNULE
  "createdBy"          TEXT,
  "createdAt"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "RendezVous_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "RendezVous_clientId_fkey" FOREIGN KEY ("clientId")
    REFERENCES "Client" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "RendezVous_startAt_idx"   ON "RendezVous" ("startAt");
CREATE INDEX IF NOT EXISTS "RendezVous_ownerSlp_idx"  ON "RendezVous" ("ownerSlp");
CREATE INDEX IF NOT EXISTS "RendezVous_status_start_idx" ON "RendezVous" ("status", "startAt");
CREATE INDEX IF NOT EXISTS "RendezVous_clientId_idx"  ON "RendezVous" ("clientId");

-- 3) Activité de prospection (timeline de la fiche prospect).
CREATE TABLE IF NOT EXISTS "ProspectionActivity" (
  "id"        TEXT NOT NULL,
  "clientId"  TEXT NOT NULL,
  "ownerSlp"  TEXT,
  "kind"      TEXT NOT NULL,        -- APPEL | MAIL | RDV | NOTE | STAGE
  "fromStage" TEXT,
  "toStage"   TEXT,
  "note"      TEXT,
  "createdBy" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ProspectionActivity_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ProspectionActivity_clientId_fkey" FOREIGN KEY ("clientId")
    REFERENCES "Client" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "ProspectionActivity_clientId_idx" ON "ProspectionActivity" ("clientId", "createdAt");

-- 4) RLS deny-all (comme les autres tables) : aucune policy → PostgREST bloqué,
--    Prisma (rôle de service) bypass. Pas de FORCE RLS (ne pas bloquer l'owner).
ALTER TABLE "RendezVous"          ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ProspectionActivity" ENABLE ROW LEVEL SECURITY;
