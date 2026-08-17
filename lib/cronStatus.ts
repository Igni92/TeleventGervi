/**
 * JOURNAL DES TÂCHES PLANIFIÉES (cron) — visibilité dans l'app.
 *
 * Sur ce VPS, les crons passent par /etc/cron.d/televent → televent-cron-call
 * (curl localhost). La sortie `logger` de ce script N'ATTEINT PAS journald :
 * impossible de savoir depuis l'OS si un cron a tourné. On journalise donc
 * CHAQUE appel côté APP : le helper televent-cron-call pingue /api/cron/record
 * APRÈS l'appel (succès comme échec) → AppSetting `cronrun:<route>`, lu ensuite
 * dans Paramètres → « État des tâches planifiées ». Universel : aucune route n'a
 * besoin d'être instrumentée individuellement.
 *
 * Best-effort : un échec d'écriture ne doit jamais faire échouer le cron.
 */
import { prisma } from "@/lib/prisma";

const PREFIX = "cronrun:";

/** Crons ATTENDUS (source de vérité = deploy/cron/televent.cron). Sert à afficher
 *  « jamais exécuté » quand aucune trace, et à détecter un retard (staleAfterMs). */
export const KNOWN_CRONS: { route: string; label: string; cadence: string; staleAfterMs: number }[] = [
  { route: "/api/sap/sync/mirror", label: "Miroir SAP — factures, commandes, BL, réceptions", cadence: "toutes les 10 min", staleAfterMs: 60 * 60 * 1000 },
  { route: "/api/sap/sync/delta", label: "Stock SAP incrémental", cadence: "toutes les 10 min", staleAfterMs: 60 * 60 * 1000 },
  { route: "/api/inventaire/refresh-stock", label: "Rafraîchissement du stock inventaire", cadence: "toutes les 15 min", staleAfterMs: 90 * 60 * 1000 },
  { route: "/api/sap/sync/products", label: "Catalogue produits + stock complet", cadence: "2×/h", staleAfterMs: 3 * 60 * 60 * 1000 },
  { route: "/api/vendeur-reassign/revert", label: "Retour des bascules vendeur (congés)", cadence: "chaque matin (3h20)", staleAfterMs: 30 * 60 * 60 * 1000 },
  { route: "/api/cron/legal-rate", label: "Taux d'intérêt légal (Banque de France)", cadence: "1×/jour", staleAfterMs: 3 * 24 * 60 * 60 * 1000 },
  { route: "/api/cron/archive-sync", label: "Archive documents (boîte factures-archive@)", cadence: "toutes les 30 min", staleAfterMs: 3 * 60 * 60 * 1000 },
  { route: "/api/cron/archive-link", label: "Chaînage documents (BL → Facture → Avoir)", cadence: "toutes les 15 min", staleAfterMs: 90 * 60 * 1000 },
  { route: "/api/sap/clients/import", label: "Base clients SAP (rafraîchissement quotidien)", cadence: "1×/jour (4h05)", staleAfterMs: 30 * 60 * 60 * 1000 },
];

export interface CronRun {
  route: string;
  /** Date ISO de la dernière exécution. */
  lastRun: string;
  ok: boolean;
  /** Durée de l'exécution en ms (mesurée par le helper). */
  durationMs: number;
  /** Détail court (résumé de succès ou message d'erreur, tronqué). */
  detail: string;
}

/** Journalise une exécution de cron (best-effort, jamais bloquant). */
export async function recordCronRun(route: string, ok: boolean, detail: string, durationMs = 0): Promise<void> {
  try {
    const value = JSON.stringify({
      route,
      lastRun: new Date().toISOString(),
      ok,
      durationMs: Math.max(0, Math.round(durationMs)),
      detail: String(detail).slice(0, 500),
    } satisfies CronRun);
    await prisma.appSetting.upsert({
      where: { key: PREFIX + route },
      update: { value },
      create: { key: PREFIX + route, value },
    });
  } catch (e) {
    console.error(`[cronStatus] journalisation impossible pour ${route}:`, e);
  }
}

/** Lit toutes les exécutions journalisées (par route). */
export async function listCronRuns(): Promise<Map<string, CronRun>> {
  const out = new Map<string, CronRun>();
  try {
    const rows = await prisma.appSetting.findMany({ where: { key: { startsWith: PREFIX } } });
    for (const r of rows) {
      try {
        const run = JSON.parse(r.value) as CronRun;
        if (run?.route) out.set(run.route, run);
      } catch { /* entrée illisible ignorée */ }
    }
  } catch { /* DB indispo → vide */ }
  return out;
}
