"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { screenLabel } from "@/lib/usageScreens";

/**
 * UsageTracker — instrumentation d'usage CÔTÉ CLIENT.
 *
 * Mesure, PAR ÉCRAN (route) : le temps passé (total + temps actif au 1er plan),
 * le nombre de clics (dont clics « morts » hors élément interactif et
 * rage-clicks de frustration), les frappes clavier, la profondeur de
 * défilement, les erreurs JS / rejets de promesse / erreurs de ressource, et la
 * pire latence d'interaction (INP-like via l'Event Timing API). Le contexte
 * appareil (taille d'écran, réseau, référent) est joint une fois par visite.
 *
 * Envoi par lots via navigator.sendBeacon (repli fetch keepalive) vers
 * POST /api/usage — au changement d'écran, à la mise en arrière-plan et au
 * déchargement de la page, plus un flush périodique des événements. TOTALEMENT
 * défensif : toute exception est avalée — le tracking ne doit jamais gêner
 * l'utilisateur ni casser une page. Aucune UI (retourne null).
 *
 * L'identité (email/nom) n'est PAS envoyée par le client : la route la résout
 * depuis le cookie de session (rattachement fiable, y compris au déchargement).
 */

const ENDPOINT = "/api/usage";
const SLOW_INTERACTION_MS = 200; // seuil « interaction lente » (INP-like)
const RAGE_WINDOW_MS = 800; // fenêtre de détection des rage-clicks
const RAGE_MIN = 3; // nb de clics rapprochés = frustration
const RAGE_RADIUS = 32; // px : même zone
const EVENT_FLUSH_MS = 20_000; // flush périodique des événements
const MAX_CLIENT_EVENTS = 300; // garde-fou mémoire

const INTERACTIVE_SELECTOR =
  "a,button,input,select,textarea,label,summary,[role=button],[role=link]," +
  "[role=menuitem],[role=tab],[role=option],[role=checkbox],[role=switch]," +
  '[role=radio],[contenteditable=""],[contenteditable=true],' +
  '[tabindex]:not([tabindex="-1"]),[data-usage-interactive]';

type ViewAcc = {
  path: string;
  prevPath: string | null;
  enteredAt: number;
  activeMs: number;
  clicks: number;
  deadClicks: number;
  rageClicks: number;
  keypresses: number;
  maxScrollPct: number;
  scrollableHeight: number;
  jsErrors: number;
  slowInteractions: number;
  maxInteractionMs: number | null;
  loadMs: number | null;
};

export function UsageTracker() {
  const pathname = usePathname();

  useEffect(() => {
    if (typeof window === "undefined") return;
    // Singleton : jamais deux trackers (StrictMode / double montage).
    const w = window as unknown as { __usageTrackerActive?: boolean };
    if (w.__usageTrackerActive) return;
    w.__usageTrackerActive = true;

    // ── État mutable (fermetures, pas de re-render) ──
    let view: ViewAcc | null = null;
    let currentPath = "";
    let prevPath: string | null = null;
    let firstView = true;
    const events: Record<string, unknown>[] = [];
    const active = { visible: document.visibilityState !== "hidden", start: 0 as number | null };
    let rage: { x: number; y: number; t: number; count: number } | null = null;
    const observers: PerformanceObserver[] = [];

    function getSessionId(): string {
      try {
        let id = sessionStorage.getItem("televent:usageSid");
        if (!id) {
          id = crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`;
          sessionStorage.setItem("televent:usageSid", id);
        }
        return id;
      } catch {
        return `anon-${Math.random().toString(16).slice(2)}`;
      }
    }

    function collectDevice() {
      let connection: string | null = null;
      try {
        connection = (navigator as unknown as { connection?: { effectiveType?: string } })
          .connection?.effectiveType ?? null;
      } catch { /* ignore */ }
      let referrer: string | null = null;
      try { if (document.referrer) referrer = new URL(document.referrer).host || null; } catch { /* ignore */ }
      return {
        viewportW: window.innerWidth,
        viewportH: window.innerHeight,
        screenW: window.screen?.width,
        screenH: window.screen?.height,
        dpr: window.devicePixelRatio,
        connection,
        lang: navigator.language,
        referrer,
      };
    }

    function describeEl(el: EventTarget | null): string | null {
      if (!(el instanceof Element)) return null;
      const tag = el.tagName.toLowerCase();
      const id = el.id ? `#${el.id}` : "";
      const cls =
        typeof el.className === "string" && el.className.trim()
          ? "." + el.className.trim().split(/\s+/).slice(0, 2).join(".")
          : "";
      const label = el.getAttribute?.("aria-label") || el.getAttribute?.("title") || "";
      const txt = (el.textContent || "").trim().replace(/\s+/g, " ").slice(0, 40);
      let s = `${tag}${id}${cls}`;
      if (label) s += ` [${label.slice(0, 40)}]`;
      else if (txt) s += ` «${txt}»`;
      return s.slice(0, 200);
    }

    function pushEvent(ev: Record<string, unknown>) {
      if (events.length >= MAX_CLIENT_EVENTS) return;
      events.push({ path: currentPath, screen: screenLabel(currentPath), at: Date.now(), ...ev });
    }

    function send(views: unknown[], evs: unknown[], useBeacon: boolean) {
      if (!views.length && !evs.length) return;
      let body = "";
      try { body = JSON.stringify({ sessionId, device, views, events: evs }); } catch { return; }
      if (useBeacon && typeof navigator.sendBeacon === "function") {
        try {
          const ok = navigator.sendBeacon(ENDPOINT, new Blob([body], { type: "application/json" }));
          if (ok) return;
        } catch { /* repli fetch */ }
      }
      try {
        fetch(ENDPOINT, {
          method: "POST",
          body,
          headers: { "Content-Type": "application/json" },
          keepalive: true,
          cache: "no-store",
        }).catch(() => {});
      } catch { /* ignore */ }
    }

    function flushEvents(useBeacon: boolean) {
      if (events.length) send([], events.splice(0), useBeacon);
    }

    function beginView(path: string) {
      view = {
        path,
        prevPath,
        enteredAt: Date.now(),
        activeMs: 0,
        clicks: 0,
        deadClicks: 0,
        rageClicks: 0,
        keypresses: 0,
        maxScrollPct: 0,
        scrollableHeight: 0,
        jsErrors: 0,
        slowInteractions: 0,
        maxInteractionMs: null,
        // 1re vue : « temps jusqu'à l'app prête » (proxy = uptime au montage).
        loadMs: firstView ? Math.round(performance.now()) : null,
      };
      firstView = false;
      currentPath = path;
      active.visible = document.visibilityState !== "hidden";
      active.start = active.visible ? performance.now() : null;
      rage = null;
    }

    function endView(useBeacon: boolean) {
      const v = view;
      if (!v) return;
      if (active.visible && active.start != null) {
        v.activeMs += performance.now() - active.start;
        active.start = active.visible ? performance.now() : null;
      }
      const leftAt = Date.now();
      const durationMs = Math.max(0, leftAt - v.enteredAt);
      const evs = events.splice(0);
      // Filtre les « sauts » transitoires (redirections) : très court, aucune
      // interaction ni problème → n'encombre pas la table.
      const transient =
        durationMs < 800 && v.clicks === 0 && v.keypresses === 0 &&
        v.maxScrollPct === 0 && v.jsErrors === 0 && v.rageClicks === 0;
      const views = transient
        ? []
        : [{
            path: v.path,
            screen: screenLabel(v.path),
            prevPath: v.prevPath ?? undefined,
            enteredAt: v.enteredAt,
            leftAt,
            durationMs,
            activeMs: Math.min(durationMs, Math.round(v.activeMs)),
            clicks: v.clicks,
            deadClicks: v.deadClicks,
            rageClicks: v.rageClicks,
            keypresses: v.keypresses,
            maxScrollPct: v.maxScrollPct,
            scrollableHeight: v.scrollableHeight,
            jsErrors: v.jsErrors,
            slowInteractions: v.slowInteractions,
            maxInteractionMs: v.maxInteractionMs ?? undefined,
            loadMs: v.loadMs ?? undefined,
          }];
      view = null;
      if (views.length || evs.length) send(views, evs, useBeacon);
    }

    function rotateTo(path: string) {
      if (path === currentPath) return;
      const from = currentPath;
      endView(false);
      prevPath = from || null;
      beginView(path);
    }
    // Exposé pour l'effet de rotation (dépend de `pathname`).
    (w as unknown as { __usageRotate?: (p: string) => void }).__usageRotate = rotateTo;

    // Identité de session + contexte appareil (helpers déclarés ci-dessus).
    const sessionId = getSessionId();
    const device = collectDevice();

    // ── Écouteurs ──
    const onClick = (e: MouseEvent) => {
      const v = view;
      if (!v) return;
      v.clicks++;
      const t = e.target;
      const interactive = t instanceof Element ? t.closest(INTERACTIVE_SELECTOR) : null;
      if (!interactive) {
        v.deadClicks++;
        pushEvent({ type: "dead_click", target: describeEl(t) });
      }
      const x = e.clientX, y = e.clientY, now = e.timeStamp;
      if (rage && now - rage.t <= RAGE_WINDOW_MS && Math.hypot(x - rage.x, y - rage.y) <= RAGE_RADIUS) {
        rage.count++; rage.t = now; rage.x = x; rage.y = y;
        if (rage.count === RAGE_MIN) {
          v.rageClicks++;
          pushEvent({ type: "rage_click", target: describeEl(interactive || t), value: rage.count, meta: { x, y } });
        }
      } else {
        rage = { x, y, t: now, count: 1 };
      }
    };

    const onKey = () => { if (view) view.keypresses++; };

    let scrollScheduled = false;
    const onScroll = () => {
      if (scrollScheduled) return;
      scrollScheduled = true;
      requestAnimationFrame(() => {
        scrollScheduled = false;
        const v = view;
        if (!v) return;
        const doc = document.documentElement;
        const scrollTop = window.scrollY || doc.scrollTop || 0;
        const vh = window.innerHeight || doc.clientHeight || 0;
        const dh = Math.max(doc.scrollHeight, document.body?.scrollHeight || 0);
        const scrollable = Math.max(0, dh - vh);
        v.scrollableHeight = scrollable;
        const pct = scrollable <= 0 ? 100 : Math.min(100, Math.round(((scrollTop + vh) / dh) * 100));
        if (pct > v.maxScrollPct) v.maxScrollPct = pct;
      });
    };

    const onError = (e: ErrorEvent) => {
      const v = view;
      const target = e.target as (Element & { src?: string; href?: string }) | null;
      // Erreur de RESSOURCE (img/script/css…) : e.target est un élément.
      if (target && target !== (window as unknown as EventTarget) && target.tagName) {
        if (v) v.jsErrors++;
        pushEvent({
          type: "resource_error",
          target: describeEl(target),
          message: (target.src || target.href || "").slice(0, 500),
        });
        return;
      }
      if (v) v.jsErrors++;
      pushEvent({
        type: "error",
        message: (e.message || "").slice(0, 500),
        meta: { filename: e.filename, lineno: e.lineno, colno: e.colno },
      });
    };

    const onRejection = (e: PromiseRejectionEvent) => {
      const v = view;
      if (v) v.jsErrors++;
      let msg = "";
      try {
        const r = e.reason as { message?: string } | undefined;
        msg = r?.message || String(e.reason);
      } catch { /* ignore */ }
      pushEvent({ type: "unhandled_rejection", message: msg.slice(0, 500) });
    };

    const onVisibility = () => {
      if (document.visibilityState === "hidden") {
        if (active.visible && active.start != null && view) {
          view.activeMs += performance.now() - active.start;
        }
        active.visible = false; active.start = null;
        flushEvents(true);
      } else {
        active.visible = true; active.start = performance.now();
      }
    };

    const onPageHide = () => endView(true);
    const onPageShow = (e: PageTransitionEvent) => {
      if (e.persisted && !view) { beginView(currentPath || window.location.pathname); }
    };

    document.addEventListener("click", onClick, true);
    document.addEventListener("keydown", onKey, true);
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("error", onError, true);
    window.addEventListener("unhandledrejection", onRejection);
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", onPageHide);
    window.addEventListener("pageshow", onPageShow);

    // Event Timing API (INP-like) — interactions lentes. Non supporté partout.
    try {
      const po = new PerformanceObserver((list) => {
        for (const entry of list.getEntries() as (PerformanceEntry & { target?: Element })[]) {
          const d = Math.round(entry.duration);
          if (d < SLOW_INTERACTION_MS) continue;
          const v = view;
          if (v) { v.slowInteractions++; if (d > (v.maxInteractionMs ?? 0)) v.maxInteractionMs = d; }
          pushEvent({ type: "slow_interaction", value: d, target: entry.target ? describeEl(entry.target) : null, meta: { name: entry.name } });
        }
      });
      po.observe({ type: "event", durationThreshold: SLOW_INTERACTION_MS, buffered: true } as PerformanceObserverInit);
      observers.push(po);
    } catch { /* API absente : on s'en passe */ }

    const flushTimer = window.setInterval(() => flushEvents(true), EVENT_FLUSH_MS);

    // Démarre la 1re vue (route au montage).
    beginView(window.location.pathname);

    return () => {
      window.clearInterval(flushTimer);
      document.removeEventListener("click", onClick, true);
      document.removeEventListener("keydown", onKey, true);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("error", onError, true);
      window.removeEventListener("unhandledrejection", onRejection);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", onPageHide);
      window.removeEventListener("pageshow", onPageShow);
      observers.forEach((o) => { try { o.disconnect(); } catch { /* ignore */ } });
      endView(true);
      w.__usageTrackerActive = false;
      (w as unknown as { __usageRotate?: unknown }).__usageRotate = undefined;
    };
    // Montage unique — la rotation par route est gérée par l'effet ci-dessous.
  }, []);

  // Rotation d'écran : à chaque changement de route, on clôt la vue précédente
  // et on en ouvre une nouvelle (via la fonction exposée par l'effet de montage).
  useEffect(() => {
    if (typeof window === "undefined" || !pathname) return;
    const rotate = (window as unknown as { __usageRotate?: (p: string) => void }).__usageRotate;
    rotate?.(pathname);
  }, [pathname]);

  return null;
}
