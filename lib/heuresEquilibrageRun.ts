/**
 * ÉQUILIBRAGE — application + HISTORIQUE (persistance AppSetting). La logique de
 * décision est PURE (lib/heuresEquilibrage) ; ici on charge les données, on
 * applique le plan et on JOURNALISE chaque passage (une entrée immuable par
 * run : `rheqlog:<horodatage>-<rand>`).
 *
 * SÉCURITÉ « aucune heure supp en moins » : on ne touche jamais aux heures
 * saisies ni aux options « paiement » ; on ne fait que (1) marquer en récup les
 * semaines supp indécises et (2) convertir des jours de CP à venir en récup.
 * Le garde-fou `totalArbitrableMin` (inchangé) est revérifié par salarié avant écriture
 * — au moindre écart, le salarié est ignoré et l'anomalie est journalisée.
 */
import { prisma } from "./prisma";
import {
  listProfiles, listAllWeekEntries, saveWeekEntry, getWeekEntry, tagDaysInWeeks,
} from "./heuresRh";
import { listAllConges, getConge, saveConge } from "./congesRh";
import { weekDates } from "./heuresCalc";
import { expandOuvrables, isoWeekOfDate } from "./planning";
import { planEquilibrage, type EqWeekInput, type EquilibragePlan } from "./heuresEquilibrage";
import type { CongeRequest } from "./conges";

const LOG_PREFIX = "rheqlog:";

export type EquilibrageSource = "cron" | "manual";

export interface EquilibrageEmployeeResult {
  email: string;
  name: string;
  weekOptionChanges: EquilibragePlan["weekOptionChanges"];
  conversions: EquilibragePlan["conversions"];
  cpGivenBackDays: number;
  recupDebitMin: number;
  suppInvariantOk: boolean;   // total heures supp inchangé (doit être true)
}

export interface EquilibrageRunLog {
  runId: string;
  runAt: string;
  by: string;
  source: EquilibrageSource;
  dryRun: boolean;
  results: EquilibrageEmployeeResult[];
  totals: {
    employees: number;
    weeksToRecup: number;
    cpDaysGivenBack: number;
    recupDebitMin: number;
    anomalies: number;
  };
}

/** Court identifiant aléatoire (pas de dépendance crypto — suffixe d'unicité). */
function rand(): string {
  return Math.random().toString(36).slice(2, 8);
}

function newRunId(now: Date): string {
  // Préfixe horodaté ISO → tri lexicographique == tri chronologique.
  return `${now.toISOString()}-${rand()}`;
}

/** Applique UNE conversion CP→récup (met à jour le congé + reporte les tags). */
async function applyConversion(
  email: string,
  conv: EquilibragePlan["conversions"][number],
  by: string,
): Promise<void> {
  const cur = await getConge(email, conv.congeId);
  if (!cur) return;

  if (conv.cpStart == null) {
    // Congé ENTIÈREMENT converti → il devient un congé de type « récup ».
    await saveConge({ ...cur, type: "recup", start: conv.recupStart, end: conv.recupEnd });
  } else {
    // Conversion PARTIELLE : le préfixe devient récup, le suffixe reste CP
    // (nouveau congé distinct, même statut/origine).
    await saveConge({ ...cur, type: "recup", start: conv.recupStart, end: conv.recupEnd });
    const suffix: CongeRequest = {
      ...cur,
      id: `${cur.id}-cp${rand()}`,
      type: "cp",
      start: conv.cpStart,
      end: conv.cpEnd as string,
      note: cur.note ? `${cur.note} · reste CP (équilibrage)` : "Reste CP après équilibrage",
    };
    await saveConge(suffix);
  }

  // Report dans la feuille d'heures UNIQUEMENT pour un congé VALIDÉ (un congé
  // en attente n'est pas encore inscrit au calendrier). Les jours récup
  // écrasent le tag « congés » posé à la validation initiale.
  if (cur.status === "approved") {
    const recupDays = expandOuvrables(conv.recupStart, conv.recupEnd);
    if (recupDays.length) {
      await tagDaysInWeeks(email, recupDays, "recup", by, isoWeekOfDate, weekDates).catch(() => {});
    }
  }
}

/** Applique le PLAN d'un salarié (étape 1 semaines + étape 2 conversions). */
async function applyPlan(plan: EquilibragePlan, by: string): Promise<void> {
  // Étape 1 : semaines supp indécises → récup (on préserve jours + recupDates).
  for (const w of plan.weekOptionChanges) {
    const cur = await getWeekEntry(plan.email, w.week);
    if (!cur || cur.option !== null) continue; // ré-entrance : ne rien réécraser
    await saveWeekEntry(plan.email, w.week, cur.days, by, {
      option: "recup",
      recupDates: cur.recupDates,
    });
  }
  // Étape 2 : conversions CP → récup.
  for (const conv of plan.conversions) {
    await applyConversion(plan.email, conv, by);
  }
}

/**
 * Lance l'équilibrage pour TOUS les salariés. `dryRun` → calcule et journalise
 * l'aperçu SANS rien modifier (bouton « prévisualiser »). Renvoie le journal du
 * run (persisté sauf en dryRun).
 */
export async function runEquilibrage(opts: {
  by: string;
  source: EquilibrageSource;
  dryRun?: boolean;
  todayISO?: string;
}): Promise<EquilibrageRunLog> {
  const now = new Date();
  const todayISO = opts.todayISO ?? now.toISOString().slice(0, 10);
  const dryRun = !!opts.dryRun;

  const [profiles, allWeeks, allConges] = await Promise.all([
    listProfiles(),
    listAllWeekEntries(),
    listAllConges(),
  ]);

  // Ensemble des salariés = profils ∪ saisies ∪ congés.
  const congesByEmail = new Map<string, CongeRequest[]>();
  const names = new Map<string, string>();
  for (const c of allConges) {
    (congesByEmail.get(c.email) ?? congesByEmail.set(c.email, []).get(c.email)!).push(c);
    if (c.name) names.set(c.email, c.name);
  }
  const emails = new Set<string>([...profiles.keys(), ...allWeeks.keys(), ...congesByEmail.keys()]);

  const results: EquilibrageEmployeeResult[] = [];
  for (const email of [...emails].sort()) {
    const profile = profiles.get(email) ?? { weeklyHours: 35, typicalDay: { m1: "06:00", m2: "13:00" } };
    const entries: EqWeekInput[] = [...(allWeeks.get(email)?.entries() ?? [])].map(([week, e]) => ({
      week, days: e.days, option: e.option, paySuppMin: e.paySuppMin, recupDates: e.recupDates,
    }));
    const conges = congesByEmail.get(email) ?? [];
    const name = names.get(email) ?? email;

    const plan = planEquilibrage({ email, name, profile, entries, conges, todayISO });
    const suppInvariantOk = plan.totalArbitrableMinBefore === plan.totalArbitrableMinAfter;

    // Garde-fou : si le total d'heures supp changeait, on N'APPLIQUE PAS.
    if (!dryRun && suppInvariantOk && (plan.weekOptionChanges.length || plan.conversions.length)) {
      await applyPlan(plan, opts.by);
    }

    if (plan.weekOptionChanges.length || plan.conversions.length || !suppInvariantOk) {
      results.push({
        email, name,
        weekOptionChanges: plan.weekOptionChanges,
        conversions: plan.conversions,
        cpGivenBackDays: plan.cpGivenBackDays,
        recupDebitMin: plan.recupDebitMin,
        suppInvariantOk,
      });
    }
  }

  const log: EquilibrageRunLog = {
    runId: newRunId(now),
    runAt: now.toISOString(),
    by: opts.by,
    source: opts.source,
    dryRun,
    results,
    totals: {
      employees: results.length,
      weeksToRecup: results.reduce((s, r) => s + r.weekOptionChanges.length, 0),
      cpDaysGivenBack: results.reduce((s, r) => s + r.cpGivenBackDays, 0),
      recupDebitMin: results.reduce((s, r) => s + r.recupDebitMin, 0),
      anomalies: results.filter((r) => !r.suppInvariantOk).length,
    },
  };

  // Journalisation IMMUABLE (une clé unique par run) — sauf en prévisualisation.
  if (!dryRun) {
    await prisma.appSetting.create({
      data: { key: LOG_PREFIX + log.runId, value: JSON.stringify(log) },
    }).catch((e) => console.error("[equilibrage] journalisation:", e));
  }
  return log;
}

/** Historique des runs, plus récents d'abord (max `limit`). */
export async function listEquilibrageLog(limit = 50): Promise<EquilibrageRunLog[]> {
  try {
    const rows = await prisma.appSetting.findMany({ where: { key: { startsWith: LOG_PREFIX } } });
    const logs = rows
      .map((r) => { try { return JSON.parse(r.value) as EquilibrageRunLog; } catch { return null; } })
      .filter((l): l is EquilibrageRunLog => !!l)
      .sort((a, b) => (a.runAt < b.runAt ? 1 : -1));
    return logs.slice(0, limit);
  } catch { return []; }
}
