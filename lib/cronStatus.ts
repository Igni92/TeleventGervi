/**
 * JOURNAL DES TÂCHES PLANIFIÉES (cron) — visibilité dans l'app.
 *
 * Sur ce VPS, les crons passent par /etc/cron.d/televent → televent-cron-call
 * (curl localhost). La sortie `logger` de ce script N'ATTEINT PAS journald :
 * impossible de savoir depuis l'OS si un cron a tourné. On journalise donc
 * CHAQUE exécution côté APP (AppSetting `cronrun:<nom>`), lue ensuite dans
 * Paramètres → « État des tâches planifiées ».
 *
 * Best-effort : un échec d'écriture ne doit jamais faire échouer le cron lui-même.
 */
import { prisma } from "@/lib/prisma";

const PREFIX = "cronrun:";

/** Crons ATTENDUS (pour afficher « jamais exécuté » quand aucune trace). La
 *  cadence est indicative (source de vérité = /etc/cron.d/televent). */
export const KNOWN_CRONS: { name: string; label: string; cadence: string; path: string }[] = [
  { name: "sap-sync", label: "Synchro SAP (miroir + produits)", cadence: "toutes les 30 min", path: "/api/cron/sap-sync" },
  { name: "legal-rate", label: "Taux d'intérêt légal (Banque de France)", cadence: "1×/jour", path: "/api/cron/legal-rate" },
];

export interface CronRun {
  name: string;
  /** Date ISO de la dernière exécution. */
  lastRun: string;
  ok: boolean;
  /** Durée de l'exécution en ms. */
  durationMs: number;
  /** Détail court (résumé de succès ou message d'erreur, tronqué). */
  detail: string;
}

/** Journalise une exécution de cron (best-effort, jamais bloquant). */
export async function recordCronRun(
  name: string,
  ok: boolean,
  detail: string,
  durationMs = 0,
): Promise<void> {
  try {
    const value = JSON.stringify({
      name,
      lastRun: new Date().toISOString(),
      ok,
      durationMs: Math.max(0, Math.round(durationMs)),
      detail: String(detail).slice(0, 500),
    } satisfies CronRun);
    await prisma.appSetting.upsert({
      where: { key: PREFIX + name },
      update: { value },
      create: { key: PREFIX + name, value },
    });
  } catch (e) {
    console.error(`[cronStatus] journalisation impossible pour ${name}:`, e);
  }
}

/** Lit toutes les exécutions journalisées (par nom). */
export async function listCronRuns(): Promise<Map<string, CronRun>> {
  const out = new Map<string, CronRun>();
  try {
    const rows = await prisma.appSetting.findMany({ where: { key: { startsWith: PREFIX } } });
    for (const r of rows) {
      try {
        const run = JSON.parse(r.value) as CronRun;
        if (run?.name) out.set(run.name, run);
      } catch { /* entrée illisible ignorée */ }
    }
  } catch { /* DB indispo → vide */ }
  return out;
}
