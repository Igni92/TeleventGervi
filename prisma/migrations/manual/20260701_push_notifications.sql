-- ─────────────────────────────────────────────────────────────────────────
-- Notifications push (PWA) — abonnements Web-Push + horodatage de notification
-- des rappels dus.
--
--   • Table "PushSubscription" : 1 ligne par navigateur/appareil abonné.
--   • Colonne "Rappel"."notifiedAt" : anti-doublon d'envoi côté cron.
--
-- Idempotent (IF NOT EXISTS). Additif : ne touche aucune donnée existante.
-- RLS activé deny-all (cohérent avec les 45 autres tables — Prisma bypass via
-- rôle de service ; PostgREST anon/authenticated bloqué).
--   En prod :  psql "$DATABASE_URL" -f prisma/migrations/manual/20260701_push_notifications.sql
--   (ou via Supabase MCP apply_migration). Côté client local : prisma generate.
-- ─────────────────────────────────────────────────────────────────────────

-- 1) Anti-doublon d'envoi de notification pour les rappels.
ALTER TABLE "Rappel" ADD COLUMN IF NOT EXISTS "notifiedAt" TIMESTAMP(3);
CREATE INDEX IF NOT EXISTS "Rappel_statut_dateRappel_idx" ON "Rappel" ("statut", "dateRappel");

-- 2) Abonnements Web-Push.
CREATE TABLE IF NOT EXISTS "PushSubscription" (
  "id"        TEXT NOT NULL,
  "userId"    TEXT NOT NULL,
  "email"     TEXT,
  "endpoint"  TEXT NOT NULL,
  "p256dh"    TEXT NOT NULL,
  "auth"      TEXT NOT NULL,
  "userAgent" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PushSubscription_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "PushSubscription_endpoint_key" ON "PushSubscription" ("endpoint");
CREATE INDEX IF NOT EXISTS "PushSubscription_userId_idx" ON "PushSubscription" ("userId");

-- 3) RLS deny-all (comme les autres tables) : aucune policy → anon/authenticated
--    (PostgREST) bloqués. Prisma se connecte via le rôle de service qui bypass
--    la RLS (posture identique aux 45 tables existantes). On n'ajoute PAS FORCE
--    RLS pour ne pas risquer de bloquer le propriétaire de la table.
ALTER TABLE "PushSubscription" ENABLE ROW LEVEL SECURITY;
