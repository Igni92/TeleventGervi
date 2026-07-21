-- ─────────────────────────────────────────────────────────────────────────
-- ANALYTIQUE D'USAGE (audit interne) — combien de clics, combien de temps,
-- sur quel écran, depuis quel appareil, et QUELS PROBLÈMES (erreurs JS,
-- rage-clicks, clics morts, interactions lentes).
--
--   • Table "UsageScreenView" : 1 ligne par VISITE d'écran (le « fichier »
--     central demandé). Agrège le temps passé (total + temps actif au 1er plan),
--     les clics (dont clics morts / rage-clicks), le défilement (profondeur max),
--     les frappes clavier, les erreurs et la pire latence d'interaction (INP-like).
--   • Table "UsageEvent" : flux d'événements fins pour le diagnostic — 1 ligne
--     par erreur / rage-click / clic mort / interaction lente / erreur de
--     ressource… avec la cible, la valeur numérique et un contexte JSON libre.
--
-- Additif & idempotent (IF NOT EXISTS) : ne touche AUCUNE donnée existante.
-- RLS activé deny-all (cohérent avec toutes les autres tables — Prisma bypass
-- via le rôle de service ; PostgREST anon/authenticated bloqué).
--
--   En prod :  psql "$DATABASE_URL" -f prisma/migrations/manual/20260721_usage_analytics.sql
--   (ou via Supabase MCP apply_migration). Côté client local : prisma generate.
-- ─────────────────────────────────────────────────────────────────────────

-- 1) Vue d'écran — le cœur : temps + clics + contexte, une ligne par visite.
CREATE TABLE IF NOT EXISTS "UsageScreenView" (
  "id"               TEXT NOT NULL,
  -- Regroupe une « visite » (onglet navigateur). UUID généré côté client.
  "sessionId"        TEXT NOT NULL,
  -- Auteur (peut être NULL = non authentifié, ex. écran de connexion).
  "userId"           TEXT,
  "userEmail"        TEXT,
  "userName"         TEXT,
  -- Route (pathname) + libellé humain de l'écran (dérivé de la nav).
  "path"             TEXT NOT NULL,
  "screen"           TEXT,
  -- Écran précédent (flux de navigation / entonnoir).
  "prevPath"         TEXT,
  -- Appareil : type + OS + navigateur (parsés du user-agent côté serveur).
  "deviceType"       TEXT,                     -- 'mobile' | 'tablet' | 'desktop'
  "os"               TEXT,
  "browser"          TEXT,
  "browserVersion"   TEXT,
  "viewportW"        INTEGER,
  "viewportH"        INTEGER,
  "screenW"          INTEGER,
  "screenH"          INTEGER,
  "dpr"              DOUBLE PRECISION,          -- devicePixelRatio (rétina, zoom)
  "connection"       TEXT,                      -- effectiveType : '4g' | '3g' | 'wifi'…
  "lang"             TEXT,
  "referrer"         TEXT,                      -- hôte referrer (entrée externe)
  "enteredAt"        TIMESTAMP(3) NOT NULL,
  "leftAt"           TIMESTAMP(3),
  "durationMs"       INTEGER NOT NULL DEFAULT 0,   -- temps total sur l'écran
  "activeMs"         INTEGER NOT NULL DEFAULT 0,   -- temps au 1er plan (onglet visible)
  "clicks"           INTEGER NOT NULL DEFAULT 0,
  "deadClicks"       INTEGER NOT NULL DEFAULT 0,   -- clics hors élément interactif
  "rageClicks"       INTEGER NOT NULL DEFAULT 0,   -- rafales de clics (frustration)
  "keypresses"       INTEGER NOT NULL DEFAULT 0,
  "maxScrollPct"     INTEGER NOT NULL DEFAULT 0,   -- profondeur de défilement 0..100
  "scrollableHeight" INTEGER,                      -- hauteur défilable (px)
  "jsErrors"         INTEGER NOT NULL DEFAULT 0,
  "slowInteractions" INTEGER NOT NULL DEFAULT 0,   -- interactions > seuil
  "maxInteractionMs" INTEGER,                      -- pire latence d'interaction (INP-like)
  "loadMs"           INTEGER,                      -- temps de rendu de l'écran (1re vue)
  "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "UsageScreenView_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "UsageScreenView_path_idx"       ON "UsageScreenView" ("path");
CREATE INDEX IF NOT EXISTS "UsageScreenView_userEmail_idx"  ON "UsageScreenView" ("userEmail");
CREATE INDEX IF NOT EXISTS "UsageScreenView_enteredAt_idx"  ON "UsageScreenView" ("enteredAt");
CREATE INDEX IF NOT EXISTS "UsageScreenView_sessionId_idx"  ON "UsageScreenView" ("sessionId");
CREATE INDEX IF NOT EXISTS "UsageScreenView_deviceType_idx" ON "UsageScreenView" ("deviceType");

-- 2) Événement fin — 1 ligne par signal de diagnostic (problèmes surtout).
CREATE TABLE IF NOT EXISTS "UsageEvent" (
  "id"          TEXT NOT NULL,
  "sessionId"   TEXT NOT NULL,
  "userId"      TEXT,
  "userEmail"   TEXT,
  "path"        TEXT NOT NULL,
  "screen"      TEXT,
  -- 'click' | 'rage_click' | 'dead_click' | 'error' | 'unhandled_rejection'
  -- | 'resource_error' | 'slow_interaction' | 'scroll_depth' | 'nav' | 'perf'
  "type"        TEXT NOT NULL,
  "target"      TEXT,                       -- sélecteur / libellé / texte de l'élément
  "value"       DOUBLE PRECISION,           -- valeur numérique (latence ms, % scroll…)
  "message"     TEXT,                       -- message d'erreur / détail
  "meta"        JSONB,                      -- contexte structuré libre
  "deviceType"  TEXT,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "UsageEvent_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "UsageEvent_type_createdAt_idx" ON "UsageEvent" ("type", "createdAt");
CREATE INDEX IF NOT EXISTS "UsageEvent_path_idx"           ON "UsageEvent" ("path");
CREATE INDEX IF NOT EXISTS "UsageEvent_userEmail_idx"      ON "UsageEvent" ("userEmail");
CREATE INDEX IF NOT EXISTS "UsageEvent_sessionId_idx"      ON "UsageEvent" ("sessionId");
CREATE INDEX IF NOT EXISTS "UsageEvent_createdAt_idx"      ON "UsageEvent" ("createdAt");

-- 3) RLS deny-all (comme les ~55 autres tables) : aucune policy → anon /
--    authenticated (PostgREST) bloqués. Prisma se connecte via le rôle de
--    service qui bypass la RLS. On n'ajoute PAS FORCE RLS (ne pas risquer de
--    bloquer le propriétaire de la table).
ALTER TABLE "UsageScreenView" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "UsageEvent"      ENABLE ROW LEVEL SECURITY;
