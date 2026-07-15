/**
 * PLANNING (congés + récup) — logique PURE (testée hors React/Prisma).
 *
 * Règles métier, TOUJOURS à l'avantage du salarié et VALIDÉES par l'employeur :
 *
 *   • COMPTEUR RÉCUP (heures) — crédit = heures supp MAJORÉES des semaines dont
 *     l'employeur a choisi l'option « récupération » (repos compensateur de
 *     remplacement : les +25 %/+50 % sont acquis en repos, ex. 8 h supp à
 *     +25 % = 10 h de récup) ; débit = jours de récup posés, décomptés
 *     UNIQUEMENT AU PASSAGE DE LA SEMAINE : si, au final, la semaine atteint
 *     quand même le contrat (les 35 h sont faites), le déficit est nul → la
 *     récup N'EST PAS déduite. Le débit est borné par min(déficit réel, jours
 *     OUVRÉS lun→ven posés × journée type). Crédit majoré + débit à l'heure
 *     brute = doublement à l'avantage du salarié.
 *
 *   • COMPTEUR CP (jours) — solde annuel fixé par l'employeur (période de
 *     référence 1er juin → 31 mai) − jours OUVRABLES (lun→sam) des congés payés
 *     VALIDÉS de la période. Un jour de CP validé est compté comme TRAVAILLÉ
 *     dans la feuille d'heures (journée type créditée, cf. computeWeek).
 *
 *   • PLAFOND RÉCUP (heures, fixé par l'employeur) — tout excédent du compteur
 *     au-delà du plafond part au PAIEMENT des heures supp sur le bulletin du
 *     mois SUIVANT ; l'excédent est reporté sur l'état mensuel envoyé à la
 *     compta (lib/heuresPdf).
 */
import {
  computeWeek, dayMinutes, isoWeekId, typicalDayMinutes, weekDates,
  type DayHours, type DayTag, type HeuresOption, type HoursProfile,
} from "./heuresCalc";
import { isIsoDate, rangesOverlap, type CongeRequest, type CongeType } from "./conges";
import { frenchHolidayLabel } from "./livraison";

/* ─────────────────────────── Dates utilitaires ────────────────────────────── */

/** « YYYY-MM-DD » → Date UTC midi (aucune dérive de fuseau). */
const atNoon = (iso: string) => new Date(`${iso}T12:00:00Z`);

/** Semaine ISO d'une date ISO (« 2026-07-13 » → « 2026-W29 »). */
export function isoWeekOfDate(dateISO: string): string {
  const d = atNoon(dateISO);
  return isoWeekId(new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

/** Toutes les dates ISO d'une plage incluse (garde-fou 400 jours). */
export function expandDates(start: string, end: string): string[] {
  if (!isIsoDate(start) || !isIsoDate(end) || end < start) return [];
  const out: string[] = [];
  const d = atNoon(start);
  while (out.length < 400) {
    const iso = d.toISOString().slice(0, 10);
    if (iso > end) break;
    out.push(iso);
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}

/** Jours OUVRABLES (lun→sam) d'une plage — décompte des CP à la française.
 *  Ni les DIMANCHES ni les JOURS FÉRIÉS (chômés) ne consomment un congé : ils
 *  sont exclus du décompte — toujours à l'avantage du salarié. */
export function expandOuvrables(start: string, end: string): string[] {
  return expandDates(start, end).filter((d) => atNoon(d).getUTCDay() !== 0 && !frenchHolidayLabel(d));
}

/** Jours de SEMAINE (lun→ven) d'une plage — jours crédités d'une journée type
 *  quand un CP est validé (5 journées type = le contrat d'une semaine pleine). */
export function expandSemaine(start: string, end: string): string[] {
  return expandDates(start, end).filter((d) => {
    const dow = atNoon(d).getUTCDay();
    return dow >= 1 && dow <= 5;
  });
}

/** SAMEDIS (hors fériés) d'une plage. Un CP est décompté en jours ouvrables
 *  (lun→sam) mais un samedi n'est PAS crédité comme travaillé (expandSemaine =
 *  lun→ven) : il coûte donc un CP « à vide ». On les repère pour proposer de la
 *  récup à la place — à l'avantage du salarié (ses CP sont préservés). Un samedi
 *  férié est déjà non décompté → exclu ici aussi (rien à « éviter »). */
export function saturdaysInRange(start: string, end: string): string[] {
  return expandDates(start, end).filter((d) => atNoon(d).getUTCDay() === 6 && !frenchHolidayLabel(d));
}

/** Sous-plage de congé (dates ISO incluses). */
export interface LeaveRange { start: string; end: string }

export interface LeaveSplit {
  recup: LeaveRange | null;   // portion payée par la récup (jours ENTIERS), ou null
  cp: LeaveRange | null;      // portion en congés payés, ou null
  recupDays: number;          // jours de contrat (lun→ven) couverts par la récup
  cpDays: number;             // jours ouvrables (lun→sam hors dim/fériés) en CP
}

/**
 * DÉCOUPE une plage de congé en portion RÉCUP + portion CP, en n'utilisant que
 * des JOURS ENTIERS de récup (à l'avantage du salarié : la récup se consomme
 * avant les CP, jamais une journée partielle).
 *
 * `recupWholeDays` = nombre de journées ENTIÈRES de récup disponibles =
 * floor(solde de récup / journée type). Ex. 18 h de récup, journée 7h15 →
 * 2 jours (14h30), pas 3 (21h45 > 18 h). On affecte les `recupWholeDays`
 * PREMIERS jours de contrat (lun→ven hors fériés) à la récup ; le reste part en
 * CP. Deux sous-plages CONTIGUËS (préfixe récup / suffixe CP).
 */
export function splitLeaveRecupCp(start: string, end: string, recupWholeDays: number): LeaveSplit {
  const days = expandDates(start, end);
  if (days.length === 0) return { recup: null, cp: null, recupDays: 0, cpDays: 0 };

  const isContract = (d: string) => {
    const dow = atNoon(d).getUTCDay();
    return dow >= 1 && dow <= 5 && !frenchHolidayLabel(d);
  };
  const contractTotal = days.filter(isContract).length;
  const n = Math.max(0, Math.min(Math.floor(recupWholeDays), contractTotal));

  // Aucune journée entière de récup → tout en CP.
  if (n <= 0) {
    return { recup: null, cp: { start, end }, recupDays: 0, cpDays: expandOuvrables(start, end).length };
  }
  // La récup couvre TOUS les jours de contrat de la plage → tout en récup
  // (les samedis éventuels sont gratuits en récup).
  if (n >= contractTotal) {
    return { recup: { start, end }, cp: null, recupDays: contractTotal, cpDays: 0 };
  }
  // Sinon : récup = préfixe couvrant les n premiers jours de contrat, CP = suffixe.
  let count = 0, splitIdx = 0;
  for (let i = 0; i < days.length; i++) {
    if (isContract(days[i]) && ++count === n) { splitIdx = i; break; }
  }
  // Le CP démarre au PROCHAIN jour de contrat (lun→ven) après la récup. Les
  // samedis (et dimanches) qui suivent immédiatement la récup sont COUVERTS par
  // la semaine ainsi complétée à 35 h (heures travaillées + récup) : ils ne sont
  // PAS décomptés — c.-à-d. quand la récup va jusqu'au vendredi, le samedi qui
  // suit est gratuit ; on ne pose un CP qu'à partir du lundi suivant.
  let cpIdx = splitIdx + 1;
  while (cpIdx < days.length && !isContract(days[cpIdx])) cpIdx++;
  if (cpIdx >= days.length) {
    // Plus aucun jour de contrat après la récup → tout est couvert (samedi
    // éventuel absorbé par la semaine complétée), pas de CP.
    return { recup: { start, end }, cp: null, recupDays: n, cpDays: 0 };
  }
  const cp = { start: days[cpIdx], end };
  return {
    recup: { start, end: days[splitIdx] },
    cp,
    recupDays: n,
    cpDays: expandOuvrables(cp.start, cp.end).length,
  };
}

/* ─────────────────────── Grille du calendrier mensuel ─────────────────────── */

export interface GridDay { date: string; inMonth: boolean }

/** Jours du calendrier du mois, en SEMAINES PLEINES lun→dim (le lundi de la
 *  semaine du 1er → le dimanche de la semaine du dernier jour). */
export function monthGridDays(monthId: string): GridDay[] {
  const m = /^(\d{4})-(\d{2})$/.exec(monthId);
  if (!m) return [];
  const year = Number(m[1]), month = Number(m[2]);
  const first = new Date(Date.UTC(year, month - 1, 1, 12));
  const last = new Date(Date.UTC(year, month, 0, 12));
  const start = new Date(first);
  start.setUTCDate(first.getUTCDate() - ((first.getUTCDay() || 7) - 1));
  const stop = new Date(last);
  stop.setUTCDate(last.getUTCDate() + (7 - (last.getUTCDay() || 7)));
  const out: GridDay[] = [];
  const d = new Date(start);
  while (d.getTime() <= stop.getTime() && out.length < 42) {
    const iso = d.toISOString().slice(0, 10);
    out.push({ date: iso, inMonth: d.getUTCMonth() === month - 1 });
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}

/* ──────────────────── Catégorie affichée d'une case du calendrier ───────────
 * Une case = UNE pastille dominante, avec son libellé court (CP, Récup, …).
 * Règle métier (demande) : PRÉSENT PAR DÉFAUT sur l'horaire type (lun→ven) —
 * on ne « change » la pastille que pour un CP / récup / absence / maladie /
 * autre, un jour FÉRIÉ (prioritaire, jour chômé), ou un congé en attente. Le
 * week-end et les jours hors mois n'affichent rien par défaut. */

/** Catégories possibles d'une pastille (congés + présence + férié). */
export type DayCategory =
  | "present" | "ferie"
  | "cp" | "rtt" | "recup" | "maladie" | "sans_solde" | "autre" | "absent" | "conges";

/** Libellé COURT affiché DANS la pastille (« CP » pour congés payés, etc.). */
export const DAY_CATEGORY_LABEL: Record<DayCategory, string> = {
  present: "Présent",
  ferie: "Férié",
  cp: "CP",
  rtt: "RTT",
  recup: "Récup",
  maladie: "Maladie",
  sans_solde: "Sans solde",
  autre: "Autre",
  absent: "Absent",
  conges: "Congés",
};

export interface CalendarDayResolved {
  /** Catégorie dominante, ou null = rien à afficher (week-end / hors planning). */
  category: DayCategory | null;
  /** Congé en attente de validation (pastille creuse/pointillée). */
  pending: boolean;
  /** Récup posée pas encore décomptée (repos à venir). */
  planned: boolean;
  /** Libellé du férié, si `category === "ferie"`. */
  ferieLabel: string | null;
}

/** Un tag de feuille d'heures (present/absent/conges/récup/maladie) → catégorie. */
function tagToCategory(tag: DayTag): DayCategory {
  return tag === "conges" ? "conges" : tag;
}

/**
 * Résout la pastille DOMINANTE d'un jour à partir de tout ce qui le touche.
 * Priorité : férié (jour chômé) → congé validé → tag feuille d'heures → congé
 * en attente → récup posée → PRÉSENT PAR DÉFAUT (lun→ven du mois) → rien.
 */
export function resolveCalendarDay(input: {
  dow: number;                 // 0 = dimanche … 6 = samedi (UTC)
  inMonth: boolean;
  ferieLabel?: string | null;  // libellé jour férié, ou null/absent
  approvedTypes?: CongeType[];  // types des congés VALIDÉS ce jour
  pendingTypes?: CongeType[];   // types des congés EN ATTENTE ce jour
  tag?: DayTag;                 // tag de la feuille d'heures
  recupPosee?: boolean;         // jour de récup posé (planning)
}): CalendarDayResolved {
  const { dow, inMonth, ferieLabel, approvedTypes = [], pendingTypes = [], tag, recupPosee } = input;

  if (ferieLabel) return { category: "ferie", pending: false, planned: false, ferieLabel };
  if (approvedTypes.length) return { category: approvedTypes[0] as DayCategory, pending: false, planned: false, ferieLabel: null };
  if (tag) return { category: tagToCategory(tag), pending: false, planned: false, ferieLabel: null };
  if (pendingTypes.length) return { category: pendingTypes[0] as DayCategory, pending: true, planned: false, ferieLabel: null };
  if (recupPosee) return { category: "recup", pending: false, planned: true, ferieLabel: null };

  // PRÉSENT PAR DÉFAUT : jour travaillé (lundi→SAMEDI) du mois, rien d'autre posé.
  // Le samedi est un jour travaillé dans l'entreprise → présent par défaut, comme
  // un jour de semaine (seul le dimanche reste hors calendrier de travail).
  const isWorkday = dow >= 1 && dow <= 6;
  if (inMonth && isWorkday) return { category: "present", pending: false, planned: false, ferieLabel: null };

  return { category: null, pending: false, planned: false, ferieLabel: null };
}

/* ────────────────────────── Compteur RÉCUP (heures) ───────────────────────── */

/** Semaine d'entrée du compteur : la saisie brute (jours + option employeur). */
export interface CounterWeekInput {
  week: string;                    // « YYYY-Www »
  days: DayHours[];                // 7 jours saisis
  option: HeuresOption | null;     // décision employeur (récup / paiement)
  recupDates?: string[];           // jours de récup posés (option « récup »)
}

export interface RecupCounter {
  creditMin: number;      // heures supp MAJORÉES créditées (+25/+50 inclus — semaines option « récup » passées)
  debitMin: number;       // récup réellement déduite (au passage des semaines)
  balanceMin: number;     // solde disponible = crédit − débit
  plannedDates: string[]; // jours de récup posés PAS ENCORE décomptés (à venir)
}

/**
 * Calcule le compteur de récup « au » `asOfISO` (exclu) : seules les semaines
 * TERMINÉES (dimanche < asOf) comptent — crédit ET débit. Pour la vue temps
 * réel : asOf = aujourd'hui ; pour l'état mensuel compta : asOf = lendemain du
 * dernier jour du mois.
 *
 * `extraRecupDates` = jours de récup validés via le planning (boomerang) qui ne
 * figurent pas déjà dans les saisies de semaines.
 */
export function computeRecupCounter(
  weeks: CounterWeekInput[],
  extraRecupDates: string[],
  profile: Pick<HoursProfile, "weeklyHours" | "typicalDay">,
  asOfISO: string,
): RecupCounter {
  const typDay = typicalDayMinutes(profile);
  const byWeek = new Map<string, { input: CounterWeekInput | null; recupDays: Set<string> }>();
  const slot = (w: string) => {
    let s = byWeek.get(w);
    if (!s) { s = { input: null, recupDays: new Set() }; byWeek.set(w, s); }
    return s;
  };

  for (const w of weeks) {
    slot(w.week).input = w;
    // Jours de récup posés depuis la semaine des supp (pointent vers d'AUTRES semaines).
    for (const d of w.recupDates ?? []) if (isIsoDate(d)) slot(isoWeekOfDate(d)).recupDays.add(d);
    // Jours taggés « récup » directement dans la feuille d'heures.
    const dates = weekDates(w.week);
    w.days.forEach((day, i) => { if (day?.tag === "recup" && dates[i]) slot(w.week).recupDays.add(dates[i]); });
  }
  for (const d of extraRecupDates) if (isIsoDate(d)) slot(isoWeekOfDate(d)).recupDays.add(d);

  let creditMin = 0, debitMin = 0;
  const plannedDates: string[] = [];
  for (const [week, { input, recupDays }] of byWeek) {
    const dates = weekDates(week);
    const done = dates.length === 7 && dates[6] < asOfISO;   // semaine passée
    if (!done) {
      plannedDates.push(...recupDays);
      continue;
    }
    if (input?.option === "recup") {
      const c = computeWeek(input.days, profile.weeklyHours, typDay);
      // Repos compensateur de remplacement : on crédite les heures MAJORÉES
      // (+25 %/+50 % inclus), pas les heures brutes — 8 h supp à +25 % =
      // 10 h de récup. Rétroactif : le compteur est recalculé depuis les
      // saisies, donc la récup déjà acquise est revalorisée automatiquement.
      creditMin += c.majEquivMin;
    }
    if (recupDays.size > 0) {
      // Seuls les JOURS DE CONTRAT (lun→ven, hors fériés) consomment de la
      // récup : un samedi / dimanche / jour férié posé n'est pas travaillé → il
      // n'y a AUCUNE heure à récupérer dessus. Ainsi, poser vendredi + samedi ne
      // décompte que le vendredi (le samedi, au-delà des 35 h lun→ven, est
      // gratuit) — à l'avantage du salarié.
      const contractRecupDays = [...recupDays].filter((d) => {
        const dow = atNoon(d).getUTCDay();
        return dow >= 1 && dow <= 5 && !frenchHolidayLabel(d);
      }).length;
      const posableMin = contractRecupDays * typDay;
      if (input) {
        // Semaine saisie : le déficit RÉEL tranche. Contrat atteint malgré la
        // récup → déficit 0 → RIEN n'est déduit (à l'avantage du salarié).
        const c = computeWeek(input.days, profile.weeklyHours, typDay);
        const deficit = Math.max(0, c.contractMin - c.totalMin);
        debitMin += Math.min(deficit, posableMin);
      } else {
        // Aucune saisie : la récup est réputée prise comme posée — mais seuls
        // les jours ouvrés (lun→ven hors fériés) la décomptent.
        debitMin += posableMin;
      }
    }
  }
  return { creditMin, debitMin, balanceMin: creditMin - debitMin, plannedDates: plannedDates.sort() };
}

/** Excédent du compteur AU-DELÀ du plafond employeur (minutes) — part au
 *  PAIEMENT sur le bulletin du mois suivant. 0 si pas de plafond/pas d'excédent. */
export function recupCapExcessMin(balanceMin: number, recupCapHours: number | null | undefined): number {
  if (recupCapHours == null || !Number.isFinite(recupCapHours)) return 0;
  return Math.max(0, balanceMin - Math.round(recupCapHours * 60));
}

/* ─────────────────────────── Compteur CP (jours) ──────────────────────────── */

export interface CpPeriod { start: string; end: string }

/** Période de référence des CP contenant la date : 1er juin → 31 mai. */
export function cpPeriodOf(dateISO: string): CpPeriod {
  const d = atNoon(dateISO);
  const y = d.getUTCMonth() + 1 >= 6 ? d.getUTCFullYear() : d.getUTCFullYear() - 1;
  return { start: `${y}-06-01`, end: `${y + 1}-05-31` };
}

export interface CpCounter {
  allowanceDays: number | null;  // solde attribué (null = non défini par l'employeur)
  takenDays: number;             // jours ouvrables de CP VALIDÉS dans la période
  pendingDays: number;           // jours ouvrables de CP EN ATTENTE dans la période
  balanceDays: number | null;    // solde restant (null si allowance non définie)
  period: CpPeriod;
}

/** Jours ouvrables (lun→sam) d'un congé TOMBANT dans la période. */
function ouvrablesInPeriod(c: Pick<CongeRequest, "start" | "end">, p: CpPeriod): number {
  if (!rangesOverlap(c.start, c.end, p.start, p.end)) return 0;
  const start = c.start > p.start ? c.start : p.start;
  const end = c.end < p.end ? c.end : p.end;
  return expandOuvrables(start, end).length;
}

export function computeCpCounter(
  allowanceDays: number | null | undefined,
  conges: Pick<CongeRequest, "type" | "status" | "start" | "end">[],
  todayISO: string,
): CpCounter {
  const period = cpPeriodOf(todayISO);
  let takenDays = 0, pendingDays = 0;
  for (const c of conges) {
    if (c.type !== "cp") continue;
    if (c.status === "approved") takenDays += ouvrablesInPeriod(c, period);
    else if (c.status === "pending") pendingDays += ouvrablesInPeriod(c, period);
  }
  const allowance = allowanceDays == null || !Number.isFinite(allowanceDays) ? null : allowanceDays;
  return {
    allowanceDays: allowance,
    takenDays,
    pendingDays,
    balanceDays: allowance == null ? null : Math.round((allowance - takenDays) * 100) / 100,
    period,
  };
}

/* ──────────────── Récapitulatif mensuel (état compta / PDF) ────────────────── */

export interface MonthRecap {
  recupBalanceMin: number;   // solde récup à la FIN du mois
  recupCapMin: number | null;// plafond employeur (minutes) — null si non défini
  excessMin: number;         // excédent au-delà du plafond → PAIEMENT sur M+1
  cpBalanceDays: number | null;
  cpTakenDays: number;
  cpAllowanceDays: number | null;
}

/** Dernier jour du mois « YYYY-MM » → ISO, et lendemain (asOf exclusif). */
export function monthEndISO(monthId: string): string {
  const m = /^(\d{4})-(\d{2})$/.exec(monthId);
  if (!m) return "";
  return new Date(Date.UTC(Number(m[1]), Number(m[2]), 0, 12)).toISOString().slice(0, 10);
}

export function dayAfter(dateISO: string): string {
  const d = atNoon(dateISO);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

/** Récap d'UN employé à la fin d'un mois : solde récup, excédent au-delà du
 *  plafond (→ paiement M+1, reporté sur le PDF compta) et compteur CP. */
export function computeMonthRecap(
  weeks: CounterWeekInput[],
  extraRecupDates: string[],
  conges: Pick<CongeRequest, "type" | "status" | "start" | "end">[],
  profile: HoursProfile,
  monthId: string,
): MonthRecap {
  const end = monthEndISO(monthId);
  const counter = computeRecupCounter(weeks, extraRecupDates, profile, dayAfter(end));
  const cp = computeCpCounter(profile.cpAllowanceDays, conges, end);
  const capMin = profile.recupCapHours == null ? null : Math.round(profile.recupCapHours * 60);
  return {
    recupBalanceMin: counter.balanceMin,
    recupCapMin: capMin,
    excessMin: recupCapExcessMin(counter.balanceMin, profile.recupCapHours),
    cpBalanceDays: cp.balanceDays,
    cpTakenDays: cp.takenDays,
    cpAllowanceDays: cp.allowanceDays,
  };
}

/** Un jour de congé validé crédite-t-il des heures ? (CP uniquement — compté
 *  comme travaillé via la journée type ; la récup, elle, se décompte du
 *  compteur ; maladie/absence ne créditent rien.) */
export function congeCreditsHours(type: CongeRequest["type"]): boolean {
  return type === "cp";
}

/** dayMinutes réexporté pour les écrans planning (total d'une journée type). */
export { dayMinutes };
