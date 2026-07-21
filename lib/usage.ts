import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { screenLabel } from "@/lib/usageScreens";

/**
 * Analytique d'usage — ingestion serveur (best-effort).
 *
 * `ingestUsageBatch` enregistre un lot de vues d'écran + d'événements envoyés
 * par le navigateur (components/UsageTracker → POST /api/usage, via
 * navigator.sendBeacon). ENTIÈREMENT enveloppé en try/catch : le tracking ne
 * doit JAMAIS jeter ni ralentir l'app (même posture que lib/audit.writeAudit).
 *
 * Écriture en RAW SQL : les tables "UsageScreenView"/"UsageEvent" sont ajoutées
 * par migration additive et peuvent ne pas être connues du client Prisma typé
 * tant que `prisma generate` n'a pas tourné (convention du repo, cf. Promo).
 */

// ── Types du lot (côté client → serveur) ─────────────────────────────
export type UsageDevice = {
  deviceType?: string; // repli si le client l'a déjà déduit
  viewportW?: number;
  viewportH?: number;
  screenW?: number;
  screenH?: number;
  dpr?: number;
  connection?: string;
  lang?: string;
  referrer?: string;
};

export type UsageViewPayload = {
  path: string;
  screen?: string;
  prevPath?: string;
  enteredAt: number; // epoch ms
  leftAt?: number; // epoch ms
  durationMs?: number;
  activeMs?: number;
  clicks?: number;
  deadClicks?: number;
  rageClicks?: number;
  keypresses?: number;
  maxScrollPct?: number;
  scrollableHeight?: number;
  jsErrors?: number;
  slowInteractions?: number;
  maxInteractionMs?: number;
  loadMs?: number;
};

export type UsageEventPayload = {
  path: string;
  screen?: string;
  type: string;
  target?: string;
  value?: number;
  message?: string;
  meta?: unknown;
  at?: number; // epoch ms
};

export type UsageBatch = {
  sessionId: string;
  device?: UsageDevice;
  views?: UsageViewPayload[];
  events?: UsageEventPayload[];
};

export type UsageActor = {
  userId?: string | null;
  userEmail?: string | null;
  userName?: string | null;
  userAgent?: string | null;
};

// Garde-fous : on borne tout ce qui vient du client (payload non fiable).
const MAX_VIEWS = 60;
const MAX_EVENTS = 250;
const INT_MAX = 2_000_000_000; // < INTEGER Postgres (~2.147e9)

const clampInt = (n: unknown, min = 0, max = INT_MAX): number | null => {
  const v = typeof n === "number" && Number.isFinite(n) ? Math.round(n) : NaN;
  if (Number.isNaN(v)) return null;
  return Math.min(max, Math.max(min, v));
};
const clampIntDefault0 = (n: unknown): number => clampInt(n) ?? 0;
const str = (s: unknown, max = 512): string | null =>
  typeof s === "string" && s.length ? s.slice(0, max) : null;
const num = (n: unknown): number | null =>
  typeof n === "number" && Number.isFinite(n) ? n : null;
const toDate = (ms: unknown): Date | null => {
  const v = num(ms);
  if (v === null || v <= 0) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
};

const KNOWN_EVENT_TYPES = new Set([
  "click", "rage_click", "dead_click", "error", "unhandled_rejection",
  "resource_error", "slow_interaction", "scroll_depth", "nav", "perf",
]);

/**
 * Déduit type d'appareil / OS / navigateur depuis le user-agent (léger, sans
 * dépendance). Suffit pour l'audit « PC vs mobile » et le tri par navigateur.
 */
export function parseUserAgent(ua: string | null | undefined): {
  deviceType: string;
  os: string | null;
  browser: string | null;
  browserVersion: string | null;
} {
  const s = ua || "";
  const isTablet = /iPad|Tablet|PlayBook|Silk|(Android(?!.*Mobile))/i.test(s);
  const isMobile = /Mobi|iPhone|iPod|Android.*Mobile|Windows Phone|IEMobile|BlackBerry|Opera Mini/i.test(s);
  const deviceType = isTablet ? "tablet" : isMobile ? "mobile" : "desktop";

  let os: string | null = null;
  if (/Windows NT/i.test(s)) os = "Windows";
  else if (/iPhone|iPad|iPod/i.test(s)) os = "iOS";
  else if (/Mac OS X/i.test(s)) os = "macOS";
  else if (/Android/i.test(s)) os = "Android";
  else if (/Linux/i.test(s)) os = "Linux";
  else if (/CrOS/i.test(s)) os = "ChromeOS";

  let browser: string | null = null;
  let browserVersion: string | null = null;
  const pick = (re: RegExp, name: string) => {
    const m = s.match(re);
    if (m) { browser = name; browserVersion = m[1] ?? null; return true; }
    return false;
  };
  // Ordre important (Edge/Chrome se déclarent souvent comme Chrome).
  if (pick(/Edg(?:e|A|iOS)?\/([\d.]+)/i, "Edge")) { /* ok */ }
  else if (pick(/OPR\/([\d.]+)/i, "Opera")) { /* ok */ }
  else if (pick(/SamsungBrowser\/([\d.]+)/i, "Samsung Internet")) { /* ok */ }
  else if (pick(/Firefox\/([\d.]+)/i, "Firefox")) { /* ok */ }
  else if (/Chrome\/([\d.]+)/i.test(s) && !/Chromium/i.test(s)) pick(/Chrome\/([\d.]+)/i, "Chrome");
  else if (/Version\/([\d.]+).*Safari/i.test(s)) pick(/Version\/([\d.]+)/i, "Safari");
  else if (pick(/Safari\/([\d.]+)/i, "Safari")) { /* ok */ }

  return { deviceType, os, browser, browserVersion };
}

/**
 * Écrit un lot d'usage. Ne jette jamais. Retourne le nombre de lignes écrites
 * (utile pour un log de debug), 0 si rien / erreur.
 */
export async function ingestUsageBatch(batch: UsageBatch, actor: UsageActor): Promise<number> {
  try {
    const sessionId = str(batch?.sessionId, 64);
    if (!sessionId) return 0;

    const dev = parseUserAgent(actor.userAgent);
    const d = batch.device ?? {};
    const deviceType = str(d.deviceType, 16) ?? dev.deviceType;

    const userId = str(actor.userId, 64);
    const userEmail = str(actor.userEmail, 256);
    const userName = str(actor.userName, 256);

    const views = Array.isArray(batch.views) ? batch.views.slice(0, MAX_VIEWS) : [];
    const events = Array.isArray(batch.events) ? batch.events.slice(0, MAX_EVENTS) : [];

    let written = 0;

    for (const v of views) {
      const path = str(v?.path, 512);
      const enteredAt = toDate(v?.enteredAt);
      if (!path || !enteredAt) continue;
      await prisma.$executeRawUnsafe(
        `INSERT INTO "UsageScreenView"
          ("id","sessionId","userId","userEmail","userName","path","screen","prevPath",
           "deviceType","os","browser","browserVersion","viewportW","viewportH","screenW","screenH",
           "dpr","connection","lang","referrer","enteredAt","leftAt","durationMs","activeMs",
           "clicks","deadClicks","rageClicks","keypresses","maxScrollPct","scrollableHeight",
           "jsErrors","slowInteractions","maxInteractionMs","loadMs","createdAt")
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,
                 $23,$24,$25,$26,$27,$28,$29,$30,$31,$32,$33,$34, CURRENT_TIMESTAMP)`,
        randomUUID(),
        sessionId,
        userId,
        userEmail,
        userName,
        path,
        str(v.screen, 128) ?? screenLabel(path),
        str(v.prevPath, 512),
        deviceType,
        dev.os,
        dev.browser,
        dev.browserVersion,
        clampInt(d.viewportW),
        clampInt(d.viewportH),
        clampInt(d.screenW),
        clampInt(d.screenH),
        num(d.dpr),
        str(d.connection, 16),
        str(d.lang, 16),
        str(d.referrer, 256),
        enteredAt,
        toDate(v.leftAt),
        clampIntDefault0(v.durationMs),
        clampIntDefault0(v.activeMs),
        clampIntDefault0(v.clicks),
        clampIntDefault0(v.deadClicks),
        clampIntDefault0(v.rageClicks),
        clampIntDefault0(v.keypresses),
        clampInt(v.maxScrollPct, 0, 100) ?? 0,
        clampInt(v.scrollableHeight),
        clampIntDefault0(v.jsErrors),
        clampIntDefault0(v.slowInteractions),
        clampInt(v.maxInteractionMs),
        clampInt(v.loadMs),
      );
      written++;
    }

    for (const e of events) {
      const path = str(e?.path, 512);
      const type = str(e?.type, 32);
      if (!path || !type || !KNOWN_EVENT_TYPES.has(type)) continue;
      let metaJson: string | null = null;
      if (e.meta !== undefined && e.meta !== null) {
        try { metaJson = JSON.stringify(e.meta).slice(0, 4000); } catch { metaJson = null; }
      }
      await prisma.$executeRawUnsafe(
        `INSERT INTO "UsageEvent"
          ("id","sessionId","userId","userEmail","path","screen","type","target","value",
           "message","meta","deviceType","createdAt")
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12,
                 COALESCE($13::timestamptz, CURRENT_TIMESTAMP))`,
        randomUUID(),
        sessionId,
        userId,
        userEmail,
        path,
        str(e.screen, 128) ?? screenLabel(path),
        type,
        str(e.target, 512),
        num(e.value),
        str(e.message, 1000),
        metaJson,
        deviceType,
        toDate(e.at),
      );
      written++;
    }

    return written;
  } catch (err) {
    console.warn("[usage] ingestUsageBatch échoué (non-bloquant):", (err as Error).message);
    return 0;
  }
}
