/**
 * ÉQUILIBRAGE (arbitrage quotidien récup / CP) — logique PURE (testée hors
 * React/Prisma, comme lib/planning). La persistance + l'application vivent dans
 * lib/heuresEquilibrageRun (Prisma).
 *
 * RÈGLE MÉTIER (demande direction) — toujours À L'AVANTAGE DU SALARIÉ :
 *
 *   1. Les semaines dont les heures supp ARBITRABLES ne sont pas encore
 *      arbitrées (`option === null`) passent en RÉCUP. On n'écrit JAMAIS
 *      « paiement » et on ne touche pas aux heures saisies : les heures supp
 *      ne peuvent donc jamais DIMINUER (garde-fou `totalArbitrableMin` inchangé).
 *      Les heures supp STRUCTURELLES (contrat « 42 h » payé) restent payées
 *      d'office — jamais concernées par l'équilibrage.
 *
 *   2. La récup REMPLACE les jours de CP : tant qu'il reste au moins UNE
 *      journée entière de récup DISPONIBLE (journée type, ex. 7h15), un jour de
 *      CP À VENIR est converti en jour de RÉCUP — le jour de CP est RENDU au
 *      salarié (le congé n'est plus de type « cp »), la récup est débitée d'une
 *      journée. Conversion par journées ENTIÈRES uniquement (cf. splitLeaveRecupCp).
 *
 * La récup DISPONIBLE = `RecupCounter.availableMin` (solde réalisé − réserve des
 * jours déjà posés à venir) → jamais de sur-engagement, jamais de solde négatif.
 */
import {
  computeWeek, typicalDayMinutes, structuralSuppMin, splitStructuralSupp,
  type DayHours, type HeuresOption, type HoursProfile,
} from "./heuresCalc";
import {
  computeRecupCounter, expandOuvrables, splitLeaveRecupCp,
  type CounterWeekInput,
} from "./planning";
import type { CongeRequest, CongeStatus } from "./conges";

/** Une semaine dont l'option indécise passe en récup. */
export interface WeekOptionChange {
  week: string;
  suppMin: number;      // heures supp ARBITRABLES brutes de la semaine
  majEquivMin: number;  // équivalent MAJORÉ crédité au compteur de récup
}

/** Une conversion d'un congé CP (à venir) en récup, jour(s) entier(s). */
export interface CpConversion {
  congeId: string;
  status: CongeStatus;          // statut du congé converti (approved / pending)
  recupStart: string;
  recupEnd: string;
  cpStart: string | null;       // reste laissé en CP (suffixe), null si entièrement converti
  cpEnd: string | null;
  recupContractDays: number;    // jours de contrat (lun→ven hors fériés) rendus
  recupDebitMin: number;        // récup débitée = jours × journée type
}

export interface EquilibragePlan {
  email: string;
  name: string;
  weekOptionChanges: WeekOptionChange[];
  conversions: CpConversion[];
  cpGivenBackDays: number;
  recupDebitMin: number;
  typicalDayMin: number;
  recupBudgetDays: number;
  /** Témoins du garde-fou « aucune heure supp arbitrable en moins » (ÉGAUX). */
  totalArbitrableMinBefore: number;
  totalArbitrableMinAfter: number;
}

/** Entrée de semaine telle que stockée (option incluse). */
export interface EqWeekInput {
  week: string;
  days: DayHours[];
  option: HeuresOption | null;
  paySuppMin?: number | null;
  recupDates?: string[];
}

export interface EquilibrageInput {
  email: string;
  name: string;
  profile: HoursProfile;
  entries: EqWeekInput[];
  conges: CongeRequest[];
  todayISO: string;
}

/** Heures supp ARBITRABLES d'une semaine (hors structurelles payées d'office). */
function arbitrableOf(e: EqWeekInput, profile: HoursProfile, typDay: number): { arbitrableMin: number; majEquivMin: number } {
  const c = computeWeek(e.days, profile.weeklyHours, typDay);
  const st = splitStructuralSupp(c.sup25Min, c.sup50Min, structuralSuppMin(profile));
  // Tout en récup (aucune part payée) → équivalent majoré arbitrable.
  const majEquivMin = Math.round(st.arb25Min * 1.25 + st.arb50Min * 1.5);
  return { arbitrableMin: st.arbitrableMin, majEquivMin };
}

/**
 * Calcule le PLAN d'équilibrage SANS rien écrire (pur → testable).
 */
export function planEquilibrage(input: EquilibrageInput): EquilibragePlan {
  const { email, name, profile, entries, conges, todayISO } = input;
  const typDay = typicalDayMinutes(profile);

  // Garde-fou : total des heures supp ARBITRABLES AVANT (les jours saisis ne
  // bougent pas → ce total doit rester identique après l'équilibrage).
  const totalArbitrableMinBefore = entries.reduce((s, e) => s + arbitrableOf(e, profile, typDay).arbitrableMin, 0);

  // ── Étape 1 : semaines supp arbitrables indécises → récup ───────────────────
  const weekOptionChanges: WeekOptionChange[] = [];
  for (const e of entries) {
    if (e.option !== null) continue;
    const { arbitrableMin, majEquivMin } = arbitrableOf(e, profile, typDay);
    if (arbitrableMin > 0) weekOptionChanges.push({ week: e.week, suppMin: arbitrableMin, majEquivMin });
  }
  const changed = new Set(weekOptionChanges.map((w) => w.week));

  // ── Récup DISPONIBLE (après étape 1) via le compteur de main ────────────────
  const postWeeks: CounterWeekInput[] = entries.map((e) => ({
    week: e.week,
    days: e.days,
    option: changed.has(e.week) ? "recup" : e.option,
    paySuppMin: e.paySuppMin,
    recupDates: e.recupDates,
  }));
  const extraRecup = conges
    .filter((c) => c.type === "recup" && c.status === "approved")
    .flatMap((c) => expandOuvrables(c.start, c.end));
  const counter = computeRecupCounter(postWeeks, extraRecup, profile, todayISO);
  const recupBudgetDays = typDay > 0 ? Math.max(0, Math.floor(counter.availableMin / typDay)) : 0;

  // ── Étape 2 : la récup remplace les jours de CP À VENIR ─────────────────────
  const conversions: CpConversion[] = [];
  let remaining = recupBudgetDays;
  const futureCp = conges
    .filter((c) => c.type === "cp" && (c.status === "approved" || c.status === "pending"))
    // « à venir » : congés qui COMMENCENT aujourd'hui ou après (jamais rétroactif).
    .filter((c) => c.start >= todayISO)
    .sort((a, b) => (a.start === b.start ? (a.id < b.id ? -1 : 1) : a.start < b.start ? -1 : 1));

  for (const c of futureCp) {
    if (remaining <= 0) break;
    const split = splitLeaveRecupCp(c.start, c.end, remaining);
    if (!split.recup || split.recupDays <= 0) continue;
    conversions.push({
      congeId: c.id,
      status: c.status,
      recupStart: split.recup.start,
      recupEnd: split.recup.end,
      cpStart: split.cp?.start ?? null,
      cpEnd: split.cp?.end ?? null,
      recupContractDays: split.recupDays,
      recupDebitMin: split.recupDays * typDay,
    });
    remaining -= split.recupDays;
  }

  const cpGivenBackDays = conversions.reduce((s, c) => s + c.recupContractDays, 0);
  const recupDebitMin = conversions.reduce((s, c) => s + c.recupDebitMin, 0);

  return {
    email,
    name,
    weekOptionChanges,
    conversions,
    cpGivenBackDays,
    recupDebitMin,
    typicalDayMin: typDay,
    recupBudgetDays,
    totalArbitrableMinBefore,
    totalArbitrableMinAfter: totalArbitrableMinBefore, // les jours saisis ne changent pas
  };
}

/** Y a-t-il quelque chose à faire pour ce salarié ? */
export function planHasChanges(p: EquilibragePlan): boolean {
  return p.weekOptionChanges.length > 0 || p.conversions.length > 0;
}
