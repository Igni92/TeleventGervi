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
 *   - Per-call timeout (default 30s) with AbortController
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

// HTTPS agent — keepalive for connection reuse, optional TLS bypass for self-signed
const agent = new https.Agent({
  rejectUnauthorized: !INSECURE,
  keepAlive: true,
  timeout: 90_000,
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
      reject(new Error(`SAP request timeout after ${timeoutMs}ms: ${path}`));
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
      res = await rawRequest<T>(env, path, opts);
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

  // 401 → session expirée → re-login + retry une fois (logique inchangée).
  if (res.status === 401 && !opts.noRetry) {
    sessions[env] = null;
    await login(env);
    res = await rawRequest<T>(env, path, opts);
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
    const total = typeof totalStr === "number" ? totalStr : parseInt(String(totalStr));
    if (!total || total === 0) return [];
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
