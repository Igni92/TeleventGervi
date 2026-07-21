import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { requireAdmin } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";

/**
 * Rapport d'analytique d'usage — agrégats lus par l'écran d'audit des
 * Paramètres (components/settings/UsageAuditPanel). Réservé admin / direction
 * (mêmes droits que le reste de l'onglet Administration).
 *
 * Lecture seule, en raw SQL (tables ajoutées par migration additive, pas
 * forcément connues du client Prisma typé). Paramètre `days` (période),
 * borné à [1, 365], défaut 30.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Prisma renvoie les SUM/COUNT en BigInt : on ramène en number pour le JSON.
const n = (v: unknown): number =>
  typeof v === "bigint" ? Number(v) : typeof v === "number" ? v : 0;

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  const admin = await requireAdmin(session); // admin OU direction
  if (!admin) return NextResponse.json({ error: "Accès réservé" }, { status: 403 });

  const raw = Number(req.nextUrl.searchParams.get("days"));
  const days = Number.isFinite(raw) ? Math.min(365, Math.max(1, Math.round(raw))) : 30;
  const since = `NOW() - ($1::int * INTERVAL '1 day')`;

  try {
    const [totals] = (await prisma.$queryRawUnsafe(
      `SELECT COUNT(*)::int AS views,
              COUNT(DISTINCT "sessionId")::int AS sessions,
              COUNT(DISTINCT "userEmail")::int AS users,
              COALESCE(SUM("durationMs"),0)::bigint AS "totalMs",
              COALESCE(SUM("activeMs"),0)::bigint AS "activeMs",
              COALESCE(SUM("clicks"),0)::bigint AS clicks,
              COALESCE(SUM("jsErrors"),0)::int AS errors,
              COALESCE(SUM("rageClicks"),0)::int AS rage
         FROM "UsageScreenView" WHERE "enteredAt" >= ${since}`,
      days,
    )) as Record<string, unknown>[];

    const devices = (await prisma.$queryRawUnsafe(
      `SELECT COALESCE("deviceType",'?') AS "deviceType",
              COUNT(*)::int AS views,
              COALESCE(SUM("durationMs"),0)::bigint AS "totalMs"
         FROM "UsageScreenView" WHERE "enteredAt" >= ${since}
        GROUP BY 1 ORDER BY views DESC`,
      days,
    )) as Record<string, unknown>[];

    const browsers = (await prisma.$queryRawUnsafe(
      `SELECT COALESCE("browser",'?') AS browser, COUNT(*)::int AS views
         FROM "UsageScreenView" WHERE "enteredAt" >= ${since}
        GROUP BY 1 ORDER BY views DESC LIMIT 8`,
      days,
    )) as Record<string, unknown>[];

    const screens = (await prisma.$queryRawUnsafe(
      `SELECT COALESCE("screen","path") AS screen,
              COUNT(*)::int AS visits,
              COALESCE(SUM("durationMs"),0)::bigint AS "totalMs",
              COALESCE(AVG("durationMs"),0)::int AS "avgMs",
              COALESCE(AVG("activeMs"),0)::int AS "avgActiveMs",
              COALESCE(SUM("clicks"),0)::int AS clicks,
              COALESCE(AVG("maxScrollPct"),0)::int AS "avgScroll"
         FROM "UsageScreenView" WHERE "enteredAt" >= ${since}
        GROUP BY 1 ORDER BY "totalMs" DESC LIMIT 30`,
      days,
    )) as Record<string, unknown>[];

    const problems = (await prisma.$queryRawUnsafe(
      `SELECT COALESCE("screen","path") AS screen,
              COALESCE(SUM("jsErrors"),0)::int AS errors,
              COALESCE(SUM("rageClicks"),0)::int AS rage,
              COALESCE(SUM("deadClicks"),0)::int AS dead,
              COALESCE(SUM("slowInteractions"),0)::int AS slow,
              COALESCE(MAX("maxInteractionMs"),0)::int AS "worstInp"
         FROM "UsageScreenView" WHERE "enteredAt" >= ${since}
        GROUP BY 1
       HAVING SUM("jsErrors")+SUM("rageClicks")+SUM("deadClicks")+SUM("slowInteractions") > 0
        ORDER BY errors DESC, rage DESC, slow DESC LIMIT 30`,
      days,
    )) as Record<string, unknown>[];

    const topErrors = (await prisma.$queryRawUnsafe(
      `SELECT "type", COALESCE("screen","path") AS screen,
              LEFT(COALESCE("message",''),140) AS message, COUNT(*)::int AS count
         FROM "UsageEvent"
        WHERE "createdAt" >= ${since}
          AND "type" IN ('error','unhandled_rejection','resource_error')
        GROUP BY 1,2,3 ORDER BY count DESC LIMIT 20`,
      days,
    )) as Record<string, unknown>[];

    const byUser = (await prisma.$queryRawUnsafe(
      `SELECT COALESCE("userEmail",'(anonyme)') AS "userEmail",
              COUNT(*)::int AS visits,
              COALESCE(SUM("durationMs"),0)::bigint AS "totalMs"
         FROM "UsageScreenView" WHERE "enteredAt" >= ${since}
        GROUP BY 1 ORDER BY "totalMs" DESC LIMIT 15`,
      days,
    )) as Record<string, unknown>[];

    return NextResponse.json({
      days,
      totals: {
        views: n(totals?.views),
        sessions: n(totals?.sessions),
        users: n(totals?.users),
        totalMs: n(totals?.totalMs),
        activeMs: n(totals?.activeMs),
        clicks: n(totals?.clicks),
        errors: n(totals?.errors),
        rage: n(totals?.rage),
      },
      devices: devices.map((d) => ({ deviceType: String(d.deviceType), views: n(d.views), totalMs: n(d.totalMs) })),
      browsers: browsers.map((b) => ({ browser: String(b.browser), views: n(b.views) })),
      screens: screens.map((s) => ({
        screen: String(s.screen),
        visits: n(s.visits),
        totalMs: n(s.totalMs),
        avgMs: n(s.avgMs),
        avgActiveMs: n(s.avgActiveMs),
        clicks: n(s.clicks),
        avgScroll: n(s.avgScroll),
      })),
      problems: problems.map((p) => ({
        screen: String(p.screen),
        errors: n(p.errors),
        rage: n(p.rage),
        dead: n(p.dead),
        slow: n(p.slow),
        worstInp: n(p.worstInp),
      })),
      topErrors: topErrors.map((e) => ({
        type: String(e.type),
        screen: String(e.screen),
        message: String(e.message ?? ""),
        count: n(e.count),
      })),
      byUser: byUser.map((u) => ({ userEmail: String(u.userEmail), visits: n(u.visits), totalMs: n(u.totalMs) })),
    });
  } catch (err) {
    console.error("[GET /api/usage/report]", (err as Error).message);
    return NextResponse.json({ error: "Erreur serveur" }, { status: 500 });
  }
}
