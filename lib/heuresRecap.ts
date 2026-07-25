/**
 * RÉCAP HEURES SUPP par semaine + PAIEMENT FIFO — logique PURE (testée hors
 * React/Prisma). Sert l'écran/PDF « récap par personne » et l'action direction
 * « payer X heures supp » (les plus anciennes d'abord).
 *
 * Invariant CLÉ (jamais d'heure supp perdue) : pour chaque semaine,
 *   payé (majoré) + récup (majoré) + en attente (majoré) = total majoré arbitrable,
 * et la part STRUCTURELLE (contrat « 42 h » payé) s'ajoute, toujours payée.
 */
import {
  computeWeek, typicalDayMinutes, weekDates, weekAttributionMonth,
  structuralSuppMin, splitStructuralSupp, splitSupp, effectivePaySuppMin,
  type DayHours, type HeuresOption, type HoursProfile,
} from "./heuresCalc";

export interface SuppWeekRecap {
  week: string;            // « 2026-W28 »
  weekNum: number;         // 28
  from: string;            // lundi ISO
  to: string;              // dimanche ISO
  attribMonth: string;     // « YYYY-MM » (mois de paie = dernier jour travaillé)
  arb25Min: number;        // supp ARBITRABLE brute à +25 %
  arb50Min: number;        // supp ARBITRABLE brute à +50 %
  arbMin: number;          // total brut arbitrable
  majMin: number;          // équivalent majoré arbitrable (payé OU récup)
  structPaidMajMin: number;// part STRUCTURELLE (toujours payée), majorée
  option: HeuresOption | null;
  payMajMin: number;       // majoré PAYÉ (part arbitrable) selon l'option
  recupMajMin: number;     // majoré en RÉCUP
  pendingMajMin: number;   // majoré NON ENCORE arbitré (option nulle)
}

/** Une semaine a-t-elle des heures supp (arbitrables ou structurelles) ? */
function weekSupp(days: (DayHours | undefined)[], profile: HoursProfile, typDay: number) {
  const c = computeWeek(days, profile.weeklyHours, typDay);
  const st = splitStructuralSupp(c.sup25Min, c.sup50Min, structuralSuppMin(profile));
  const majMin = Math.round(st.arb25Min * 1.25 + st.arb50Min * 1.5);
  return { arb25: st.arb25Min, arb50: st.arb50Min, arbMin: st.arbitrableMin, majMin, structMaj: st.structEquivMin };
}

/** Récap par semaine (ordre chronologique) selon les options ACTUELLES. */
export function buildSuppRecap(
  entries: Iterable<[string, { days: (DayHours | undefined)[]; option: HeuresOption | null; paySuppMin?: number | null }]>,
  profile: HoursProfile,
): SuppWeekRecap[] {
  const typDay = typicalDayMinutes(profile);
  const out: SuppWeekRecap[] = [];
  for (const [week, e] of entries) {
    const { arb25, arb50, arbMin, majMin, structMaj } = weekSupp(e.days, profile, typDay);
    if (arbMin <= 0 && structMaj <= 0) continue;
    const pay = effectivePaySuppMin(e.option, e.paySuppMin, arbMin);
    const s = splitSupp(arb25, arb50, pay);
    const dates = weekDates(week);
    out.push({
      week,
      weekNum: Number(week.slice(6)) || 0,
      from: dates[0] ?? "",
      to: dates[6] ?? "",
      attribMonth: weekAttributionMonth(week, e.days),
      arb25Min: arb25, arb50Min: arb50, arbMin, majMin,
      structPaidMajMin: structMaj,
      option: e.option,
      payMajMin: e.option ? s.payEquivMin : 0,
      recupMajMin: e.option ? s.recupEquivMin : 0,
      pendingMajMin: e.option ? 0 : majMin,
    });
  }
  return out.sort((a, b) => (a.week < b.week ? -1 : a.week > b.week ? 1 : 0));
}

export interface FifoChange {
  week: string;
  option: HeuresOption;
  paySuppMin?: number;     // option « mixte » : minutes BRUTES payées
}

export interface FifoPayoutPlan {
  changes: FifoChange[];       // options à écrire (toutes les semaines supp arbitrables)
  requestedMajMin: number;     // demandé (majoré)
  paidMajMin: number;          // réellement affecté au paiement (majoré)
  leftoverMajMin: number;      // budget non utilisé (pas assez d'heures supp)
  closedWeeks: string[];       // semaines entièrement payées (clôturées)
}

/** Convertit un budget MAJORÉ (à payer) en minutes BRUTES à payer sur une
 *  semaine (la part payée consomme la tranche +25 % d'abord, puis +50 %). */
function majBudgetToBrut(arb25: number, arb50: number, budgetMaj: number): number {
  const band25Maj = arb25 * 1.25;
  if (budgetMaj <= band25Maj) return Math.round(budgetMaj / 1.25);
  const rest = budgetMaj - band25Maj;
  return arb25 + Math.round(rest / 1.5);
}

/**
 * PAIEMENT FIFO : paie `budgetMajMin` (heures MAJORÉES) en commençant par les
 * semaines LES PLUS ANCIENNES. Chaque semaine entièrement couverte passe en
 * « paiement » (clôturée) ; la semaine charnière passe en « mixte » ; les
 * suivantes en « récup ». Ré-arbitre donc toutes les semaines supp de façon
 * déterministe — jamais d'heure supp perdue (payé + récup = total, à la semaine).
 */
export function planFifoPayout(
  entries: Iterable<[string, { days: (DayHours | undefined)[]; option: HeuresOption | null; paySuppMin?: number | null }]>,
  profile: HoursProfile,
  budgetMajMin: number,
): FifoPayoutPlan {
  const typDay = typicalDayMinutes(profile);
  const weeks = [...entries]
    .map(([week, e]) => ({ week, ...weekSupp(e.days, profile, typDay) }))
    .filter((w) => w.arbMin > 0)
    .sort((a, b) => (a.week < b.week ? -1 : a.week > b.week ? 1 : 0));

  let budget = Math.max(0, Math.round(budgetMajMin));
  const requested = budget;
  let paid = 0;
  const changes: FifoChange[] = [];
  const closedWeeks: string[] = [];

  for (const w of weeks) {
    if (budget >= w.majMin) {
      // Semaine entièrement payée → clôturée.
      changes.push({ week: w.week, option: "paiement" });
      closedWeeks.push(w.week);
      budget -= w.majMin;
      paid += w.majMin;
    } else if (budget > 0) {
      // Semaine charnière : paiement partiel → mixte (paySuppMin en brut).
      const brut = Math.min(w.arbMin, majBudgetToBrut(w.arb25, w.arb50, budget));
      const s = splitSupp(w.arb25, w.arb50, brut);
      changes.push({ week: w.week, option: "mixte", paySuppMin: brut });
      paid += s.payEquivMin;
      budget = 0;
    } else {
      // Budget épuisé → le reste part en récup.
      changes.push({ week: w.week, option: "recup" });
    }
  }

  return { changes, requestedMajMin: requested, paidMajMin: paid, leftoverMajMin: budget, closedWeeks };
}
