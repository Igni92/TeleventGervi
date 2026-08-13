/**
 * TAUX D'INTÉRÊT LÉGAL — récupération AUTOMATIQUE via l'API Banque de France.
 *
 * Source : API webstat BdF (Opendatasoft), série `FM.H.FR.EUR.FR2.LIR.IFRLEGAL_PROF.YLD`
 * = « Taux d'intérêt légal applicable aux autres cas » (créances professionnelles),
 * publié chaque semestre. Chaque observation porte sa période de validité
 * (`time_period_start` → `time_period_end`) et sa valeur EN POURCENT (`obs_value`,
 * ex. 2.75). On convertit en fraction (0.0275) et on indexe par clé de semestre
 * « YYYY-S1 | YYYY-S2 » (cf. semesterKey), pour que le calcul de pénalités
 * retienne le taux EN VIGUEUR à la date de chaque relance.
 *
 * Robustesse (flux à portée juridique) : un échec réseau/API ne doit JAMAIS
 * casser une relance. La table est mise en cache en base (AppSetting) et
 * fusionnée par-dessus la table de repli codée en dur (lib/relance/legalRate).
 * Rafraîchissement paresseux : au plus une tentative réseau toutes ~20 h, et
 * forcée si le semestre courant manque au cache. Un cron peut aussi appeler
 * `refreshBdfLegalRates()` (cf. /api/cron/legal-rate).
 *
 * Clé API : env `BDF_API_KEY` (jamais commitée — cf. .env). Sans clé, on reste
 * silencieusement sur la table de repli.
 */
import { LEGAL_RATE_BY_SEMESTER, semesterKey } from "./legalRate";

const BDF_URL =
  "https://webstat.banque-france.fr/api/explore/v2.1/catalog/datasets/observations/exports/json/" +
  "?where=series_key+IN+%28%22FM.H.FR.EUR.FR2.LIR.IFRLEGAL_PROF.YLD%22%29&order_by=-time_period_start";

/** Clé AppSetting du cache (JSON `{ fetchedAt: ISO, rates: {semestre: fraction} }`). */
const CACHE_KEY = "relance_bdf_legal_rates";

/** Au-delà de cette ancienneté, on retente un fetch réseau (best-effort). */
const STALE_MS = 20 * 60 * 60 * 1000; // ~20 h

interface BdfObservation {
  time_period?: string;        // « 2026-S2 »
  time_period_start?: string;  // « 2026-07-01 »
  time_period_end?: string;    // « 2026-12-31 »
  obs_value?: number;          // 2.75  (POURCENT)
}

interface RateCache {
  fetchedAt: string;
  /** semestre (« YYYY-S1 ») → taux ANNUEL en fraction (0.0275). */
  rates: Record<string, number>;
}

/**
 * Transforme les observations brutes de l'API en table semestre → fraction.
 * `time_period` fait foi (« 2026-S2 ») ; à défaut on dérive la clé de semestre
 * depuis `time_period_start`. On ignore les lignes sans valeur numérique.
 */
export function parseBdfObservations(raw: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  if (!Array.isArray(raw)) return out;
  for (const o of raw as BdfObservation[]) {
    const pct = typeof o?.obs_value === "number" ? o.obs_value : Number(o?.obs_value);
    if (!Number.isFinite(pct)) continue;
    let key = typeof o?.time_period === "string" && /^\d{4}-S[12]$/.test(o.time_period) ? o.time_period : "";
    if (!key && o?.time_period_start) {
      const d = new Date(o.time_period_start);
      if (!Number.isNaN(d.getTime())) key = semesterKey(d);
    }
    if (!key) continue;
    out[key] = Math.round((pct / 100) * 1e6) / 1e6; // % → fraction, 6 décimales
  }
  return out;
}

/**
 * Appelle l'API BdF et renvoie la table semestre → fraction. Lève si la clé API
 * manque, si l'appel échoue, ou si la réponse est vide (aucun taux exploitable).
 */
export async function fetchBdfLegalRates(timeoutMs = 6000): Promise<Record<string, number>> {
  const key = process.env.BDF_API_KEY?.trim();
  if (!key) throw new Error("BDF_API_KEY absente de l'environnement.");
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(BDF_URL, {
      headers: { Authorization: `Apikey ${key}`, Accept: "application/json" },
      signal: ctrl.signal,
      cache: "no-store",
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    const rates = parseBdfObservations(json);
    if (Object.keys(rates).length === 0) throw new Error("réponse BdF vide (aucun taux).");
    return rates;
  } finally {
    clearTimeout(timer);
  }
}

/** Lit le cache AppSetting (best-effort, DB indispo → null). */
async function readCache(): Promise<RateCache | null> {
  try {
    const { prisma } = await import("@/lib/prisma");
    const row = await prisma.appSetting.findUnique({ where: { key: CACHE_KEY } });
    if (!row?.value) return null;
    const parsed = JSON.parse(row.value) as RateCache;
    if (parsed && typeof parsed === "object" && parsed.rates) return parsed;
  } catch {
    /* pas de cache exploitable */
  }
  return null;
}

/** Écrit le cache AppSetting (best-effort). */
async function writeCache(rates: Record<string, number>): Promise<void> {
  try {
    const { prisma } = await import("@/lib/prisma");
    const value = JSON.stringify({ fetchedAt: new Date().toISOString(), rates } satisfies RateCache);
    await prisma.appSetting.upsert({
      where: { key: CACHE_KEY },
      update: { value },
      create: { key: CACHE_KEY, value },
    });
  } catch {
    /* échec d'écriture non bloquant */
  }
}

/**
 * Force un rafraîchissement depuis l'API BdF et met à jour le cache. Renvoie la
 * table fusionnée (BdF ⊕ repli codé en dur). Best-effort : sur échec, renvoie la
 * table de repli/cache sans lever (destiné au cron et à un bouton admin).
 */
export async function refreshBdfLegalRates(): Promise<Record<string, number>> {
  try {
    const fresh = await fetchBdfLegalRates();
    await writeCache(fresh);
    return { ...LEGAL_RATE_BY_SEMESTER, ...fresh };
  } catch {
    const cache = await readCache();
    return { ...LEGAL_RATE_BY_SEMESTER, ...(cache?.rates ?? {}) };
  }
}

/**
 * Table semestre → taux ANNUEL (fraction) EN VIGUEUR, prête pour legalRateFromTable.
 * Ordre de priorité : API BdF (cache) par-dessus la table de repli codée en dur.
 * Rafraîchit le cache si (a) absent, (b) plus vieux que STALE_MS, ou (c) il ne
 * contient pas le semestre courant. Toujours non bloquant : toute erreur laisse
 * la table de repli/cache en place.
 */
export async function getLegalRateTable(opts: { allowNetwork?: boolean } = {}): Promise<Record<string, number>> {
  const allowNetwork = opts.allowNetwork ?? true;
  const cache = await readCache();
  const nowSemester = semesterKey(new Date());
  const cacheAgeMs = cache ? Date.now() - new Date(cache.fetchedAt).getTime() : Infinity;
  const missingCurrent = !cache || cache.rates[nowSemester] == null;
  const stale = cacheAgeMs > STALE_MS;

  if (allowNetwork && (missingCurrent || stale)) {
    try {
      const fresh = await fetchBdfLegalRates();
      await writeCache(fresh);
      return { ...LEGAL_RATE_BY_SEMESTER, ...fresh };
    } catch {
      /* réseau/API KO → on retombe sur le cache/repli ci-dessous */
    }
  }
  return { ...LEGAL_RATE_BY_SEMESTER, ...(cache?.rates ?? {}) };
}
