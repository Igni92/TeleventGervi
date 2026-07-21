/**
 * DDL idempotent — ANALYTIQUE D'USAGE (audit interne).
 *
 * Crée les tables "UsageScreenView" (temps + clics par écran) et "UsageEvent"
 * (flux d'événements de diagnostic : erreurs, rage-clicks, clics morts,
 * interactions lentes…). Additif : ne touche aucune donnée existante. Applique
 * le même contenu que prisma/migrations/manual/20260721_usage_analytics.sql.
 *
 *   Usage : node scripts/ddl-usage-analytics.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { PrismaClient } from "@prisma/client";

// ── env (.env puis .env.local, déséchappe \$) — modèle ddl-supplier ──
const env = {};
for (const f of [".env", ".env.local"]) {
  const p = path.resolve(process.cwd(), f);
  if (!fs.existsSync(p)) continue;
  for (const line of fs.readFileSync(p, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([\w.]+)\s*=\s*(.*)\s*$/); if (!m) continue;
    let v = m[2].trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    env[m[1]] = v.replace(/\\\$/g, "$");
  }
}
const dbUrl = (() => {
  const u = process.env.DATABASE_URL ?? env.DATABASE_URL;
  if (!u) throw new Error("DATABASE_URL introuvable (.env/.env.local)");
  const sep = u.includes("?") ? "&" : "?";
  return u.includes("connection_limit") ? u : `${u}${sep}connection_limit=2&pool_timeout=60`;
})();
const prisma = new PrismaClient({ datasources: { db: { url: dbUrl } } });

async function main() {
  console.log("══ DDL Analytique d'usage (UsageScreenView / UsageEvent) ══\n");

  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "UsageScreenView" (
      "id"               TEXT NOT NULL,
      "sessionId"        TEXT NOT NULL,
      "userId"           TEXT,
      "userEmail"        TEXT,
      "userName"         TEXT,
      "path"             TEXT NOT NULL,
      "screen"           TEXT,
      "prevPath"         TEXT,
      "deviceType"       TEXT,
      "os"               TEXT,
      "browser"          TEXT,
      "browserVersion"   TEXT,
      "viewportW"        INTEGER,
      "viewportH"        INTEGER,
      "screenW"          INTEGER,
      "screenH"          INTEGER,
      "dpr"              DOUBLE PRECISION,
      "connection"       TEXT,
      "lang"             TEXT,
      "referrer"         TEXT,
      "enteredAt"        TIMESTAMP(3) NOT NULL,
      "leftAt"           TIMESTAMP(3),
      "durationMs"       INTEGER NOT NULL DEFAULT 0,
      "activeMs"         INTEGER NOT NULL DEFAULT 0,
      "clicks"           INTEGER NOT NULL DEFAULT 0,
      "deadClicks"       INTEGER NOT NULL DEFAULT 0,
      "rageClicks"       INTEGER NOT NULL DEFAULT 0,
      "keypresses"       INTEGER NOT NULL DEFAULT 0,
      "maxScrollPct"     INTEGER NOT NULL DEFAULT 0,
      "scrollableHeight" INTEGER,
      "jsErrors"         INTEGER NOT NULL DEFAULT 0,
      "slowInteractions" INTEGER NOT NULL DEFAULT 0,
      "maxInteractionMs" INTEGER,
      "loadMs"           INTEGER,
      "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "UsageScreenView_pkey" PRIMARY KEY ("id")
    );
  `);
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "UsageScreenView_path_idx"       ON "UsageScreenView" ("path");`);
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "UsageScreenView_userEmail_idx"  ON "UsageScreenView" ("userEmail");`);
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "UsageScreenView_enteredAt_idx"  ON "UsageScreenView" ("enteredAt");`);
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "UsageScreenView_sessionId_idx"  ON "UsageScreenView" ("sessionId");`);
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "UsageScreenView_deviceType_idx" ON "UsageScreenView" ("deviceType");`);
  console.log('✅ Table "UsageScreenView" (+ index)');

  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "UsageEvent" (
      "id"          TEXT NOT NULL,
      "sessionId"   TEXT NOT NULL,
      "userId"      TEXT,
      "userEmail"   TEXT,
      "path"        TEXT NOT NULL,
      "screen"      TEXT,
      "type"        TEXT NOT NULL,
      "target"      TEXT,
      "value"       DOUBLE PRECISION,
      "message"     TEXT,
      "meta"        JSONB,
      "deviceType"  TEXT,
      "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "UsageEvent_pkey" PRIMARY KEY ("id")
    );
  `);
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "UsageEvent_type_createdAt_idx" ON "UsageEvent" ("type", "createdAt");`);
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "UsageEvent_path_idx"           ON "UsageEvent" ("path");`);
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "UsageEvent_userEmail_idx"      ON "UsageEvent" ("userEmail");`);
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "UsageEvent_sessionId_idx"      ON "UsageEvent" ("sessionId");`);
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "UsageEvent_createdAt_idx"      ON "UsageEvent" ("createdAt");`);
  console.log('✅ Table "UsageEvent" (+ index)');

  await prisma.$executeRawUnsafe(`ALTER TABLE "UsageScreenView" ENABLE ROW LEVEL SECURITY;`);
  await prisma.$executeRawUnsafe(`ALTER TABLE "UsageEvent"      ENABLE ROW LEVEL SECURITY;`);
  console.log("✅ RLS deny-all activé\n");

  const [views] = await prisma.$queryRawUnsafe(`SELECT COUNT(*)::int AS total FROM "UsageScreenView";`);
  const [events] = await prisma.$queryRawUnsafe(`SELECT COUNT(*)::int AS total FROM "UsageEvent";`);
  console.log("📊 Vues d'écran :", views, "· Événements :", events);
}

main()
  .catch((e) => { console.error("❌", e.message); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
