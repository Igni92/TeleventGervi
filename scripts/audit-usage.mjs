/**
 * Audit d'usage — lit les tables "UsageScreenView"/"UsageEvent" et imprime un
 * rapport lisible : où passe-t-on du temps, où clique-t-on, PC vs mobile, et
 * SURTOUT où sont les problèmes (erreurs, rage-clicks, clics morts, lenteurs).
 *
 *   Usage : node scripts/audit-usage.mjs [nbJours]     (défaut : 30)
 *
 * Lecture seule. Aucun effet de bord.
 */
import fs from "node:fs";
import path from "node:path";
import { PrismaClient } from "@prisma/client";

const days = Math.max(1, Number(process.argv[2] || 30));

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

const fmtMs = (ms) => {
  const s = Math.round((Number(ms) || 0) / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60), r = s % 60;
  if (m < 60) return `${m}m${String(r).padStart(2, "0")}`;
  const h = Math.floor(m / 60);
  return `${h}h${String(m % 60).padStart(2, "0")}`;
};
const pad = (s, n) => String(s ?? "").slice(0, n).padEnd(n);
const padL = (s, n) => String(s ?? "").padStart(n);

async function main() {
  const since = `NOW() - INTERVAL '${days} days'`;
  console.log(`\n══════════ AUDIT D'USAGE — ${days} derniers jours ══════════\n`);

  const [tot] = await prisma.$queryRawUnsafe(
    `SELECT COUNT(*)::int AS views, COUNT(DISTINCT "sessionId")::int AS sessions,
            COUNT(DISTINCT "userEmail")::int AS users
       FROM "UsageScreenView" WHERE "enteredAt" >= ${since};`,
  );
  if (!tot || tot.views === 0) {
    console.log("Aucune donnée d'usage sur la période. (Le tracking commence dès le déploiement.)\n");
    return;
  }
  console.log(`Visites d'écran : ${tot.views}   ·   Sessions : ${tot.sessions}   ·   Utilisateurs : ${tot.users}\n`);

  // ── PC vs mobile ──
  const devs = await prisma.$queryRawUnsafe(
    `SELECT COALESCE("deviceType",'?') AS d, COUNT(*)::int AS n, SUM("durationMs")::bigint AS t
       FROM "UsageScreenView" WHERE "enteredAt" >= ${since} GROUP BY 1 ORDER BY n DESC;`,
  );
  console.log("── Appareils ──");
  for (const r of devs) console.log(`  ${pad(r.d, 9)} ${padL(r.n, 6)} vues   ${padL(fmtMs(r.t), 8)}`);
  console.log("");

  // ── Top écrans ──
  const screens = await prisma.$queryRawUnsafe(
    `SELECT COALESCE("screen","path") AS screen,
            COUNT(*)::int AS visits,
            SUM("durationMs")::bigint AS total,
            AVG("durationMs")::bigint AS avg,
            AVG("activeMs")::bigint AS avg_active,
            SUM("clicks")::int AS clicks,
            AVG("maxScrollPct")::int AS scroll
       FROM "UsageScreenView" WHERE "enteredAt" >= ${since}
      GROUP BY 1 ORDER BY total DESC LIMIT 25;`,
  );
  console.log("── Écrans (par temps total passé) ──");
  console.log(`  ${pad("Écran", 26)} ${padL("Vues", 6)} ${padL("Temps", 8)} ${padL("Moy.", 7)} ${padL("Actif", 7)} ${padL("Clics", 6)} ${padL("Scroll", 7)}`);
  for (const r of screens) {
    console.log(`  ${pad(r.screen, 26)} ${padL(r.visits, 6)} ${padL(fmtMs(r.total), 8)} ${padL(fmtMs(r.avg), 7)} ${padL(fmtMs(r.avg_active), 7)} ${padL(r.clicks, 6)} ${padL(r.scroll + "%", 7)}`);
  }
  console.log("");

  // ── Problèmes par écran ──
  const probs = await prisma.$queryRawUnsafe(
    `SELECT COALESCE("screen","path") AS screen,
            SUM("jsErrors")::int AS errors,
            SUM("rageClicks")::int AS rage,
            SUM("deadClicks")::int AS dead,
            SUM("slowInteractions")::int AS slow,
            MAX("maxInteractionMs")::int AS worst
       FROM "UsageScreenView" WHERE "enteredAt" >= ${since}
      GROUP BY 1
     HAVING SUM("jsErrors") + SUM("rageClicks") + SUM("deadClicks") + SUM("slowInteractions") > 0
      ORDER BY errors DESC, rage DESC, slow DESC LIMIT 25;`,
  );
  console.log("── Problèmes par écran (erreurs · rage-clicks · clics morts · lenteurs) ──");
  if (!probs.length) console.log("  (aucun problème détecté 🎉)");
  else {
    console.log(`  ${pad("Écran", 26)} ${padL("Err", 5)} ${padL("Rage", 5)} ${padL("Mort", 5)} ${padL("Lent", 5)} ${padL("PireINP", 8)}`);
    for (const r of probs) {
      console.log(`  ${pad(r.screen, 26)} ${padL(r.errors, 5)} ${padL(r.rage, 5)} ${padL(r.dead, 5)} ${padL(r.slow, 5)} ${padL((r.worst || 0) + "ms", 8)}`);
    }
  }
  console.log("");

  // ── Dernières erreurs (messages) ──
  const errs = await prisma.$queryRawUnsafe(
    `SELECT "type", COALESCE("screen","path") AS screen, LEFT(COALESCE("message",''),80) AS msg, COUNT(*)::int AS n
       FROM "UsageEvent"
      WHERE "createdAt" >= ${since} AND "type" IN ('error','unhandled_rejection','resource_error')
      GROUP BY 1,2,3 ORDER BY n DESC LIMIT 15;`,
  );
  console.log("── Top messages d'erreur ──");
  if (!errs.length) console.log("  (aucune erreur journalisée)");
  else for (const r of errs) console.log(`  ${padL(r.n, 4)}×  [${pad(r.screen, 20)}] ${r.msg}`);
  console.log("");
}

main()
  .catch((e) => { console.error("❌", e.message); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
