import {
  aggregateActivity, periodBounds, previousYearBounds,
  topClientsOrder, topSalespersonsOrder, orderWeightMaps,
  crmActivity, crmCallsByCardCode,
  type Granularity,
} from "@/lib/pilotage";
import { cached, invalidate } from "@/lib/ttlCache";

/**
 * Calcul + cache des KPI « Activité du jour » (Écran 1 / bandeau d'accueil).
 *
 * Extrait de la route GET /api/pilotage/activity pour être PARTAGÉ avec le cron
 * mirror : après un tick qui ramène de nouveaux documents, le cron ré-chauffe
 * lui-même ce cache (`warmActivity`) pour que le PREMIER utilisateur qui ouvre
 * l'accueil ne déclenche jamais le recalcul à froid (le gros `Promise.all`
 * agrégats + N-1 + CRM + tops) — c'est ce recalcul qui donnait l'impression que
 * « l'app charge en boucle » juste après un tick. Le cron paie le coût une fois,
 * plus aucun humain.
 */

// Cache court par périmètre+granularité ; le tick mirror purge "pilotage:" dès
// que de nouveaux docs arrivent puis re-remplit — ce TTL n'est qu'un filet.
// TTL > période du cron (10 min). À 5 min, le cache expirait AVANT le tick
// suivant : une fois sur deux, la personne qui ouvrait l'accueil repayait le
// recalcul complet à froid — c'est la queue haute mesurée (p95 5,2 s, max 15 s)
// que le préchauffage était justement censé supprimer. La fraîcheur ne vient pas
// du TTL mais de `invalidate("pilotage:")` au tick miroir ; le TTL n'est qu'un
// filet, il doit donc couvrir l'intervalle entre deux ticks.
export const PILOTAGE_ACTIVITY_TTL_MS = 15 * 60_000;

export function activityCacheKey(slp: string | null, g: Granularity): string {
  return `pilotage:activity:${slp ?? "ALL"}:${g}`;
}

/** Calcul brut d'un bucket d'activité (sans cache). */
async function computeActivity(slp: string | null, showTransverse: boolean, g: Granularity) {
  const curr = periodBounds(g);
  const prev = previousYearBounds(curr, g);

  const [currAct, prevAct, currCrm, prevCrm, tcs, sps, weightMaps] = await Promise.all([
    aggregateActivity(curr.start, curr.end, slp),
    aggregateActivity(prev.start, prev.end, slp),
    crmActivity(curr.start, curr.end, slp),
    crmActivity(prev.start, prev.end, slp),
    topClientsOrder(curr.start, curr.end, 6, slp),
    showTransverse ? topSalespersonsOrder(curr.start, curr.end, 6) : Promise.resolve([]),
    orderWeightMaps(curr.start, curr.end, slp),
  ]);

  // Fiabilité = part des lignes du jour effectivement COSTÉES (coût hybride).
  const reliability = currAct.caProductNet > 0 ? Math.round(currAct.marginCoverage) : null;

  // Enrichit top clients avec # appels CRM + poids BL (kg) sur la même fenêtre
  const crmCalls = await crmCallsByCardCode(tcs.map((t) => t.cardCode), curr.start, curr.end);
  const clients = tcs.map((c) => ({
    ...c,
    crmCalls: crmCalls.get(c.cardCode) ?? 0,
    weightKg: weightMaps.byCard.get(c.cardCode) ?? 0,
  }));
  const salespersons = sps.map((s) => ({ ...s, weightKg: weightMaps.bySlp.get(s.slpName) ?? 0 }));

  return {
    granularity: g,
    period: { start: curr.start, end: curr.end },
    previous: { start: prev.start, end: prev.end },
    curr: currAct,
    prev: prevAct,
    crm: currCrm,
    crmPrev: prevCrm,
    clients,
    salespersons,
    reliability,
  };
}

/** Renvoie les KPI (depuis le cache si chaud). `refresh` force le recalcul. */
export async function getActivity(
  slp: string | null,
  showTransverse: boolean,
  g: Granularity,
  opts?: { refresh?: boolean },
) {
  const key = activityCacheKey(slp, g);
  if (opts?.refresh) invalidate(key);
  return cached(key, PILOTAGE_ACTIVITY_TTL_MS, () => computeActivity(slp, showTransverse, g));
}

/**
 * Ré-chauffe les KPI d'accueil pour le périmètre DIRECTION (ALL) sur les trois
 * granularités que lisent l'accueil (`day`) et le cockpit (`week`/`month`).
 * Appelé par le cron mirror juste après `invalidate("pilotage:")`.
 *
 * Best-effort : un échec de re-chauffe ne doit jamais faire échouer la synchro
 * (le prochain chargement recalculera, comme avant). Périmètre ALL uniquement :
 * couvre l'admin/direction (cas principal) ; les commerciaux scopés recalculent
 * à la demande — cache trop nombreux pour tout pré-chauffer.
 */
export async function warmActivity(): Promise<void> {
  const grans: Granularity[] = ["day", "week", "month"];
  for (const g of grans) {
    const key = activityCacheKey(null, g);
    invalidate(key); // garantit un recalcul frais (le tick vient de purger)
    try {
      await cached(key, PILOTAGE_ACTIVITY_TTL_MS, () => computeActivity(null, true, g));
    } catch (e) {
      console.error("[warmActivity]", g, e instanceof Error ? e.message : String(e));
    }
  }
}
