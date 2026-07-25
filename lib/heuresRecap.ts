/**
 * RÉCAP HEURES SUPP par semaine — logique PURE (testée hors React/Prisma).
 * Sert l'écran Salaires et le PDF « récap par personne » (lecture seule).
 *
 * Invariant : pour chaque semaine,
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
