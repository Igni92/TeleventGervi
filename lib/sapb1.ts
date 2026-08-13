/**
 * SAP Business One Service Layer client.
 *
 * Features
 * --------
 *   - Session management (login → B1SESSION cookie cached in module-scope memory)
 *   - Auto-refresh on 401 (session expired after 30 min idle) with single in-flight login lock
 *   - TLS bypass conditionally via SAP_B1_TLS_INSECURE=1 (dev only — never use in prod)
 *   - Typed helpers: get, post, patch, delete (return typed JSON via generics)
 *   - OData pagination helper: getAll<T>(path) follows @odata.nextLink until exhausted
 *   - Per-call timeout (default 90s) with AbortController
 *   - Global concurrency gate (SAP_MAX_CONCURRENCY, default 3) — cf. withSapSlot
 *
 * Usage
 * -----
 *   import { sap } from "@/lib/sapb1";
 *   const items = await sap.getAll<{ ItemCode: string }>(
 *     "/Items?$select=ItemCode,ItemName&$top=500"
 *   );
 */

import https from "node:https";
import { URL } from "node:url";

export type SapEnv = "prod" | "test";

// ── Config par environnement (lue au chargement) ──────────────
// L'env « test » retombe sur les valeurs prod pour base/user/pass si ses
// variables dédiées ne sont pas définies — seul SAP_B1_COMPANY_DB_TEST est
// strictement requis pour activer la bascule.
const CFG: Record<SapEnv, { base: string; company: string; user: string; pass: string }> = {
  prod: {
    base: process.env.SAP_B1_BASE_URL ?? "",
    company: process.env.SAP_B1_COMPANY_DB ?? "",
    user: process.env.SAP_B1_USERNAME ?? "",
    pass: process.env.SAP_B1_PASSWORD ?? "",
  },
  test: {
    base: process.env.SAP_B1_BASE_URL_TEST ?? process.env.SAP_B1_BASE_URL ?? "",
    company: process.env.SAP_B1_COMPANY_DB_TEST ?? "",
    user: process.env.SAP_B1_USERNAME_TEST ?? process.env.SAP_B1_USERNAME ?? "",
    pass: process.env.SAP_B1_PASSWORD_TEST ?? process.env.SAP_B1_PASSWORD ?? "",
  },
};
const INSECURE = process.env.SAP_B1_TLS_INSECURE === "1";

// ⚠️ MODE TEST (préversion uniquement) : on force la société SAP TEST sur les
// déploiements de préversion, SANS toucher au réglage partagé (AppSetting), pour
// ne jamais impacter la prod. JAMAIS forcé en production. À retirer après tests.
const FORCE_TEST_ENV = process.env.VERCEL_ENV === "preview";

// Environnement SAP actif (prod par défaut). Persisté en base (AppSetting.sap_env)
// et rechargé à chaque login → cohérent entre instances et redémarrages.
let activeEnv: SapEnv = FORCE_TEST_ENV ? "test" : "prod";
const cfg = () => CFG[activeEnv];

if (!CFG.prod.base || !CFG.prod.company || !CFG.prod.user || !CFG.prod.pass) {
  console.warn("[sapb1] Missing prod env vars — SAP client will fail at first call");
}

/** Recharge l'environnement actif depuis la base (silencieux si indispo). */
async function loadEnvFromDb(): Promise<void> {
  // Préversion : on reste verrouillé sur TEST, on ignore le réglage partagé.
  if (FORCE_TEST_ENV) { activeEnv = "test"; envLoaded = true; return; }
  try {
    // Import dynamique : évite de coupler le client SAP à Prisma au chargement
    // du module (sinon les tests vitest, qui ne résolvent pas l'alias @/, cassent).
    const { prisma } = await import("@/lib/prisma");
    const rows = await prisma.$queryRaw<{ value: string }[]>`
      SELECT "value" FROM "AppSetting" WHERE "key" = 'sap_env' LIMIT 1;`;
    const v = rows[0]?.value;
    if (v === "test" || v === "prod") activeEnv = v;
  } catch { /* table absente / DB indispo → garder le défaut */ }
  envLoaded = true;
}

/**
 * PORTILLON DE CONCURRENCE SAP — un seul goulot pour TOUT l'applicatif.
 *
 * Le Service Layer encaisse mal les rafales. Or une vingtaine d'appelants (scan
 * de lots, /api/livraisons, bons-commande, sync stock...) lançaient des
 * `Promise.all` NON BORNÉS — jusqu'à 8 pages de 200 documents d'un coup.
 * Mesuré en prod le 30/07/2026 : 7 pages sur 8 en timeout à 25 s, scan de lots
 * retombé à 200 réceptions au lieu de 1500, et des maps de lots PARTIELLES
 * servies pendant tout le TTL (10 min).
 *
 * Plutôt que de borner les ~25 sites d'appel un par un (et d'oublier le
 * prochain), on borne ICI : chaque requête prend un jeton, les autres font la
 * queue. Le débit total ne baisse pas — SAP ne va pas plus vite parce qu'on lui
 * crie dessus — mais on échange des échecs simultanés contre une attente
 * ordonnée qui, elle, aboutit.
 *
 * Valeur par défaut = 5, choisie sur mesure et non au doigt mouillé : le
 * rafraîchissement de stock (lib/stockSync.ts) tourne depuis toujours à 5
 * requêtes de front et boucle 104 articles en ~850 ms sans jamais échouer.
 * Descendre plus bas RALENTIRAIT un travail qui se porte bien. Ce qui casse SAP,
 * ce n'est pas la concurrence en soi mais la concurrence sur des requêtes
 * LOURDES (200 documents avec leurs lignes) : ce cas-là se borne à la source,
 * au plus près de l'appelant (cf. lib/lotResolver.ts).
 *
 * Réglable par SAP_MAX_CONCURRENCY (défaut 5).
 */
const MAX_CONCURRENCY = Math.max(1, Number(process.env.SAP_MAX_CONCURRENCY ?? 5) || 5);

let sapActive = 0;
const sapWaiters: Array<() => void> = [];

/** Exécute `fn` en tenant un jeton de concurrence SAP (toujours rendu).
 *
 * ⚠️ Pris AUTOUR de rawRequest uniquement : le temps d'attente en file ne
 * consomme donc PAS le budget `timeoutMs` de l'appel (le minuteur ne démarre
 * qu'une fois le jeton obtenu). `login()` appelle rawRequest en direct, hors
 * portillon : aucun interblocage quand un 401 déclenche un re-login. */
async function withSapSlot<T>(fn: () => Promise<T>): Promise<T> {
  if (sapActive >= MAX_CONCURRENCY) {
    await new Promise<void>((resolve) => sapWaiters.push(resolve));
  }
  sapActive++;
  try {
    return await fn();
  } finally {
    sapActive--;
    const next = sapWaiters.shift();
    if (next) next();
  }
}

// HTTPS agent — keepalive for connection reuse, optional TLS bypass for self-signed
const agent = new https.Agent({
  rejectUnauthorized: !INSECURE,
  keepAlive: true,
  timeout: 90_000,
  // Aligné sur le portillon : sans plafond, l'agent ouvrait autant de sockets
  // que d'appels simultanés (défaut Node : Infinity).
  maxSockets: MAX_CONCURRENCY,
});

// ── Session state (une session par environnement) ─────────────
// Permet des lectures PROD et des écritures TEST en parallèle (split) sans se
// marcher dessus : chaque société a son propre cookie de session.
const sessions: Record<SapEnv, string | null> = { prod: null, test: null };
const loginInflight: Record<SapEnv, Promise<void> | null> = { prod: null, test: null };
let envLoaded = false;

interface SapRequestOptions {
  method?: "GET" | "POST" | "PATCH" | "DELETE";
  body?: unknown;
  headers?: Record<string, string>;
  timeoutMs?: number;
  /** Skip auto re-login on 401 — avoids infinite recursion in login() itself */
  noRetry?: boolean;
  /** Force un environnement SAP pour CET appel (sinon = environnement actif).
   *  Les lectures de référence (stock, prix, miroir) passent "prod". */
  env?: SapEnv;
}

interface RawResponse<T> {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  body: T;
}

/** Raw HTTPS request. Returns parsed JSON if Content-Type is JSON, else raw string in body. */
function rawRequest<T = unknown>(env: SapEnv, path: string, opts: SapRequestOptions = {}): Promise<RawResponse<T>> {
  const { method = "GET", body, headers = {}, timeoutMs = 90_000 } = opts;
  const base = CFG[env].base;
  const baseWithSlash = base.endsWith("/") ? base : base + "/";
  const target = new URL(path.replace(/^\//, ""), baseWithSlash);

  return new Promise((resolve, reject) => {
    const controller = new AbortController();
    const timer = setTimeout(() => {
      controller.abort();
      // `isTimeout` : marqueur explicite pour que le retry NE rejoue PAS cet appel.
      // Le budget de temps a déjà été consommé en entier ; le rejouer 4 fois
      // multipliait la latence par 4 (jusqu'à ~6 min pour UN appel) au lieu
      // d'échouer franchement — cf. isTransientNetworkError.
      const err = new Error(`SAP request timeout after ${timeoutMs}ms: ${path}`);
      (err as Error & { isTimeout?: boolean }).isTimeout = true;
      reject(err);
    }, timeoutMs);

    const req = https.request(
      {
        hostname: target.hostname,
        port: target.port || 443,
        path: target.pathname + target.search,
        method,
        agent,
        signal: controller.signal,
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          ...(sessions[env] ? { Cookie: sessions[env] as string } : {}),
          ...headers,
        },
      },
      (res) => {
        let data = "";
        res.on("data", (c) => (data += c));
        res.on("end", () => {
          clearTimeout(timer);
          let parsed: unknown = data;
          if (res.headers["content-type"]?.includes("application/json") && data) {
            try { parsed = JSON.parse(data); } catch { /* keep string */ }
          }
          resolve({ status: res.statusCode ?? 0, headers: res.headers, body: parsed as T });
        });
      },
    );
    req.on("error", (e) => { clearTimeout(timer); reject(e); });
    if (body !== undefined && body !== null) {
      req.write(typeof body === "string" ? body : JSON.stringify(body));
    }
    req.end();
  });
}

/** Login + cache cookie pour l'environnement donné. Coalesce les appels concurrents. */
async function login(env: SapEnv): Promise<void> {
  if (loginInflight[env]) return loginInflight[env] as Promise<void>;
  loginInflight[env] = (async () => {
    const res = await rawRequest<{
      SessionId?: string;
      SessionTimeout?: number;
      Version?: string;
      error?: { code: number; message: { value: string } };
    }>(env, "Login", {
      method: "POST",
      body: { CompanyDB: CFG[env].company, UserName: CFG[env].user, Password: CFG[env].pass },
      noRetry: true,
    });
    if (res.status !== 200) {
      const msg = res.body?.error?.message?.value ?? `HTTP ${res.status}`;
      sessions[env] = null;
      throw new Error(`SAP login failed (${env}): ${msg}`);
    }
    const set = res.headers["set-cookie"];
    sessions[env] = Array.isArray(set)
      ? set.map((c) => c.split(";")[0]).join("; ")
      : "";
  })();
  try {
    await loginInflight[env];
  } finally {
    loginInflight[env] = null;
  }
}

/** Logout (best-effort) de l'environnement actif. */
export async function logout(): Promise<void> {
  const env = activeEnv;
  if (!sessions[env]) return;
  try { await rawRequest(env, "Logout", { method: "POST", noRetry: true }); } catch { /* ignore */ }
  sessions[env] = null;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Codes d'erreur réseau transitoires Node — un retry peut réussir. */
const TRANSIENT_NET_CODES = new Set(["ECONNRESET", "ETIMEDOUT", "EPIPE", "ECONNREFUSED", "EAI_AGAIN"]);

/** Vrai si l'erreur réseau (rejet de rawRequest) est transitoire et mérite un retry. */
function isTransientNetworkError(e: unknown): boolean {
  if (!e || typeof e !== "object") return false;
  // NOTRE propre timeout (cf. rawRequest) n'est PAS transitoire : le budget de
  // temps a déjà été consommé intégralement. Le rejouer multipliait la latence
  // par le nombre de tentatives (90 s → ~6 min pour un seul appel) et faisait
  // mourir la fonction au lieu de rendre une erreur exploitable. Un vrai
  // ETIMEDOUT socket (code, ci-dessous) reste lui légitimement rejoué.
  if ((e as { isTimeout?: boolean }).isTimeout) return false;
  const code = (e as { code?: string }).code;
  if (code && TRANSIENT_NET_CODES.has(code)) return true;
  const msg = (e as { message?: string }).message ?? "";
  return /socket hang up|ECONNRESET|ETIMEDOUT|EPIPE|timeout/i.test(msg);
}

/** Vrai pour une réponse HTTP transitoire (passerelle indisponible) → retry. */
function isTransientStatus(status: number): boolean {
  return status === 502 || status === 503 || status === 504;
}

// Backoff : 3 tentatives au total (delays appliqués avant retry 2 et 3).
const RETRY_DELAYS_MS = [500, 1000, 2000];

/** Core authenticated call with auto re-login on 401. env = opts.env ?? actif. */
async function call<T>(path: string, opts: SapRequestOptions = {}): Promise<T> {
  let env = opts.env;
  if (!env) {
    // Charge l'environnement persisté une fois (le toggle met à jour en mémoire ensuite).
    if (!envLoaded) await loadEnvFromDb();
    env = activeEnv;
  }
  if (!sessions[env] && !opts.noRetry) await login(env);

  // Retry réseau avec backoff sur erreurs TRANSITOIRES uniquement (un ECONNRESET
  // en milieu de pagination ne doit pas faire échouer tout un backfill).
  // Les 4xx métier (sauf 401, géré ci-dessous) NE sont PAS retentées.
  let res: RawResponse<T> | undefined;
  let lastNetError: unknown;
  const maxAttempts = opts.noRetry ? 1 : RETRY_DELAYS_MS.length + 1;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    if (attempt > 0) await sleep(RETRY_DELAYS_MS[attempt - 1]);
    try {
      res = await withSapSlot(() => rawRequest<T>(env, path, opts));
    } catch (e) {
      // Erreur réseau (rejet de la promesse) : retry si transitoire, sinon propage.
      lastNetError = e;
      if (!opts.noRetry && isTransientNetworkError(e) && attempt < maxAttempts - 1) continue;
      throw e;
    }
    // 5xx passerelle transitoire → retry (sauf noRetry / dernière tentative).
    if (!opts.noRetry && isTransientStatus(res.status) && attempt < maxAttempts - 1) {
      lastNetError = undefined;
      continue;
    }
    break;
  }
  // res est défini si on sort sans throw ; garde-fou défensif.
  if (!res) throw (lastNetError instanceof Error ? lastNetError : new Error("SAP request failed (no response)"));

  // 401 OU 403 → session invalide → re-login + retry une fois.
  //
  // Le Service Layer B1 est LOAD-BALANCÉ (cookie ROUTEID=.nodeN dans la réponse
  // de Login). Quand la session expire (30 min d'inactivité) OU que le nœud
  // épinglé par ROUTEID est recyclé, cette version du SL répond **403** — et non
  // 401 — au cookie B1SESSION devenu invalide. On ne gérait que le 401 : un 403
  // remontait donc jusqu'à l'appelant (route → 500) et l'app restait BLOQUÉE sur
  // 403 jusqu'au prochain redémarrage (la session en mémoire ne se réinitialise
  // jamais toute seule). Symptôme observé le 13/08 : miroir figé depuis la veille
  // 13h50, commandes du matin absentes de l'état alors qu'elles étaient dans SAP.
  //
  // Re-login = nouveau B1SESSION + nouveau ROUTEID → l'app se répare seule. Le
  // réessai est UNIQUE (pas de récursion : login() est en noRetry) : un vrai 403
  // de permission re-tombera en 403 et sera propagé normalement ci-dessous.
  if ((res.status === 401 || res.status === 403) && !opts.noRetry) {
    sessions[env] = null;
    await login(env);
    res = await withSapSlot(() => rawRequest<T>(env, path, opts));
  }

  if (res.status >= 400) {
    const errBody = res.body as { error?: { message?: { value?: string } } } | string;
    const message = typeof errBody === "object" && errBody?.error?.message?.value
      ? errBody.error.message.value
      : typeof errBody === "string" ? errBody.slice(0, 300) : `HTTP ${res.status}`;
    throw new Error(`SAP ${opts.method ?? "GET"} ${path} → ${res.status}: ${message}`);
  }
  return res.body;
}

// ── Public API ────────────────────────────────────────────────
export const sap = {
  /** Trigger explicit login (rarely needed — happens automatically on first call). */
  login,
  logout,

  /** Returns true if currently has a cached session cookie (env actif). */
  isAuthenticated: () => sessions[activeEnv] !== null,

  /** Environnement SAP actif + société cible + test configuré ou non. */
  getEnvironment(): { env: SapEnv; company: string; prodCompany: string; testCompany: string; testConfigured: boolean } {
    return {
      env: activeEnv,
      company: cfg().company,
      prodCompany: CFG.prod.company,
      testCompany: CFG.test.company,
      testConfigured: CFG.test.company !== "",
    };
  },

  /**
   * Bascule l'environnement SAP en mémoire et invalide la session (force un
   * re-login sur la nouvelle société au prochain appel). La persistance en base
   * est gérée par l'endpoint /api/sap/environment.
   */
  setEnvironment(env: SapEnv): void {
    if (env === "test" && CFG.test.company === "") {
      throw new Error("Environnement TEST non configuré (SAP_B1_COMPANY_DB_TEST manquant).");
    }
    activeEnv = env;
    envLoaded = true;
    // Pas besoin d'invalider les sessions : chaque env garde la sienne.
  },

  /** GET <path>. Path is relative to BASE (e.g. "/Items?$top=10" or "Items?$top=10"). */
  get<T = unknown>(path: string, opts: Omit<SapRequestOptions, "method" | "body"> = {}): Promise<T> {
    return call<T>(path, { ...opts, method: "GET" });
  },

  /** POST with JSON body. */
  post<T = unknown>(path: string, body: unknown, opts: Omit<SapRequestOptions, "method" | "body"> = {}): Promise<T> {
    return call<T>(path, { ...opts, method: "POST", body });
  },

  /** PATCH (typically returns 204). */
  patch<T = unknown>(path: string, body: unknown, opts: Omit<SapRequestOptions, "method" | "body"> = {}): Promise<T> {
    return call<T>(path, { ...opts, method: "PATCH", body });
  },

  delete<T = unknown>(path: string, opts: Omit<SapRequestOptions, "method"> = {}): Promise<T> {
    return call<T>(path, { ...opts, method: "DELETE" });
  },

  /**
   * Fast pagination — fetches the total count, then fires all pages in PARALLEL.
   * ~3-5x faster than sequential pagination for collections of ~1000s items.
   *
   * Requires an entity that supports the /$count endpoint (Items, BusinessPartners…).
   * Returns all values flattened.
   */
  async getAllParallel<T = unknown>(
    basePath: string,
    countPath: string,
    opts: { pageSize?: number; maxPages?: number; env?: SapEnv } = {},
  ): Promise<T[]> {
    const { pageSize = 500, maxPages = 50, env } = opts;
    const totalStr = await call<string | number>(countPath, { env });
    const total = typeof totalStr === "number" ? totalStr : parseInt(String(totalStr), 10);
    // Audit 2026-08-13 (#5b) : un $count NON numérique (réponse vide/malformée du Service
    // Layer — typiquement session périmée ou nœud load-balancé recyclé) donnait NaN, que
    // l'ancien `!total` confondait avec 0 → retour [] EN SILENCE. En aval,
    // refreshInStockMirror prenait ce [] pour « tout épuisé » et remettait le stock à 0.
    // On LÈVE désormais : une panne masquée en succès redevient une vraie erreur. Un vrai 0
    // (collection réellement vide) reste un [] légitime.
    if (Number.isNaN(total)) {
      throw new Error(`SAP getAllParallel: $count non numérique pour ${countPath} (reçu: ${JSON.stringify(totalStr)})`);
    }
    if (total === 0) return [];
    const pageCount = Math.min(Math.ceil(total / pageSize), maxPages);
    const pages = await Promise.all(
      Array.from({ length: pageCount }, (_, i) => {
        const skip = i * pageSize;
        const sep = basePath.includes("?") ? "&" : "?";
        const url = `${basePath}${sep}$top=${pageSize}&$skip=${skip}`;
        return call<{ value: T[] }>(url, {
          headers: { Prefer: `odata.maxpagesize=${pageSize}` },
          env,
        });
      }),
    );
    return pages.flatMap((p) => p.value ?? []);
  },

  /**
   * OData pagination helper (sequential). Use when count isn't known or for small datasets.
   *  - @odata.nextLink (newer Service Layer versions) — preferred
   *  - $skip/$top manual pagination (fallback when nextLink absent)
   *
   * Override pageSize via Prefer header (max 500 in standard SAP B1).
   */
  async getAll<T = unknown>(path: string, opts: { pageSize?: number; maxPages?: number; env?: SapEnv } = {}): Promise<T[]> {
    const { pageSize = 500, maxPages = 50, env } = opts;
    const all: T[] = [];
    let nextUrl: string | null = path;
    let page = 0;

    while (nextUrl !== null && page < maxPages) {
      const currentPath: string = nextUrl;
      const res: { value: T[]; "@odata.nextLink"?: string } =
        await call<{ value: T[]; "@odata.nextLink"?: string }>(currentPath, {
          headers: { Prefer: `odata.maxpagesize=${pageSize}` },
          env,
        });
      const batch = res.value ?? [];
      all.push(...batch);

      // Strategy 1: follow nextLink if present
      if (res["@odata.nextLink"]) {
        nextUrl = res["@odata.nextLink"];
      } else if (batch.length === pageSize) {
        // Strategy 2: manual $skip pagination if full page returned (likely more)
        const skipParam = `$skip=${all.length}`;
        nextUrl = path.includes("?") ? `${path}&${skipParam}` : `${path}?${skipParam}`;
      } else {
        nextUrl = null;
      }
      page++;
    }
    return all;
  },

  /**
   * Lecture d'une VUE (semantic layer) via le Service Layer **v2** : endpoint
   * `/b1s/v2/view.svc/<vue>`. Les vues SL (ex. `GERVI_SERG_TRCLB1SLQuery`) ne
   * sont pas exposées en v1 ; on reconstruit l'URL v2 à partir de la base v1 et
   * on réutilise la session (cookie B1SESSION commun v1/v2) + l'agent TLS.
   * Renvoie le tableau `value`. Options : filtre OData, top, env.
   */
  async getV2View<T = unknown>(
    viewName: string,
    opts: { filter?: string; top?: number; env?: SapEnv } = {},
  ): Promise<T[]> {
    let env = opts.env;
    if (!env) {
      if (!envLoaded) await loadEnvFromDb();
      env = activeEnv;
    }
    const base = CFG[env].base.replace(/\/+$/, "");
    const v2base = base.replace(/\/v1$/, "/v2");
    let url = `${v2base}/view.svc/${encodeURIComponent(viewName)}`;
    const qs: string[] = [];
    if (opts.filter) qs.push(`$filter=${encodeURIComponent(opts.filter)}`);
    if (opts.top) qs.push(`$top=${opts.top}`);
    if (qs.length) url += `?${qs.join("&")}`;
    const res = await call<{ value?: T[] }>(url, { env });
    return res.value ?? [];
  },

  /** Comme getV2View, mais PAGINÉ ($top/$skip) — pour charger une vue entière. */
  async getV2ViewAll<T = unknown>(
    viewName: string,
    opts: { filter?: string; pageSize?: number; maxPages?: number; env?: SapEnv } = {},
  ): Promise<T[]> {
    let env = opts.env;
    if (!env) {
      if (!envLoaded) await loadEnvFromDb();
      env = activeEnv;
    }
    const { filter, pageSize = 500, maxPages = 40 } = opts;
    const base = CFG[env].base.replace(/\/+$/, "");
    const v2base = base.replace(/\/v1$/, "/v2");
    const viewUrl = `${v2base}/view.svc/${encodeURIComponent(viewName)}`;
    const all: T[] = [];
    for (let page = 0; page < maxPages; page++) {
      const qs: string[] = [];
      if (filter) qs.push(`$filter=${encodeURIComponent(filter)}`);
      qs.push(`$top=${pageSize}`);
      if (page > 0) qs.push(`$skip=${page * pageSize}`);
      const res = await call<{ value?: T[] }>(`${viewUrl}?${qs.join("&")}`, { env });
      const batch = res.value ?? [];
      all.push(...batch);
      if (batch.length < pageSize) break;
    }
    return all;
  },

  /** Cookie de session de l'environnement actif (debug). */
  getCookieHeader: () => sessions[activeEnv],
};

// ── Types: common SAP B1 entities ─────────────────────────────
export interface SapItem {
  ItemCode: string;
  ItemName: string;
  ForeignName?: string;                // nom étranger = VARIÉTÉ (frgnName)
  ItemsGroupCode?: number;
  BarCode?: string;                    // code-barres / EAN13
  // Conditionnement de VENTE (Sales*)
  SalesUnit?: string;                  // ex. "pie" — unité de VENTE
  SalesPackagingUnit?: string;         // emballage de vente (ex. "CAT I")
  SalesQtyPerPackUnit?: number;        // qté par emballage de vente (ex. 12)
  SalesItemsPerUnit?: number;          // unités par unité de vente (NumInSale)
  SalesUnitWeight?: number;            // poids d'1 unité en kg (ex. 0.125)
  // Conditionnement de STOCKAGE (Inventory*)
  InventoryUOM?: string;               // ex. "pie" — unité de STOCKAGE
  // Conditionnement d'ACHAT (Purchase*)
  PurchaseUnit?: string;               // unité d'ACHAT
  PurchasePackagingUnit?: string;      // emballage d'achat
  PurchaseQtyPerPackUnit?: number;     // qté par emballage d'achat
  PurchaseItemsPerUnit?: number;       // unités par unité d'achat (NumInBuy)
  ManageBatchNumbers?: "tYES" | "tNO";
  QuantityOnStock?: number;
  Valid?: "tYES" | "tNO";
  Frozen?: "tYES" | "tNO";
  ItemWarehouseInfoCollection?: SapItemWarehouse[];
  // Listes de prix (n°2 = prix d'achat, cf. lib/gerviPricing PURCHASE_PRICE_LIST)
  ItemPrices?: { PriceList: number; Price?: number | null; Currency?: string | null }[];
  // Custom Gervifrais fields (UDF U_*)
  U_Pays?: string;
  U_GER_Marque?: string;
  U_GER_Det_Condt?: string;
  U_GER_CALIBRE?: string;
  U_GER_UVC?: string;
  U_GER_NB_BARQ_COLIS?: number;
}

export interface SapItemWarehouse {
  WarehouseCode: string;
  InStock?: number;
  Committed?: number;
  Ordered?: number;
}

export interface SapItemGroup {
  Number: number;
  GroupName: string;
}

export interface SapBatchDetail {
  ItemCode: string;
  ItemDescription?: string;
  Batch: string;
  Status?: string;
  AdmissionDate?: string;
  ManufacturingDate?: string;
  ExpirationDate?: string;
  SystemNumber?: number;
  DocEntry?: number;
  BatchAttribute1?: string;
  BatchAttribute2?: string;
  Details?: string;
}
