/**
 * GESTION HORAIRE HEBDOMADAIRE — calculs PURS (testés hors React/Prisma).
 *
 * L'employé saisit ses heures réelles (matin + après-midi) jour par jour ;
 * l'app compare au CONTRAT hebdomadaire (profil : heures hebdo + journée type)
 * et ventile l'écart :
 *   • total > contrat → HEURES SUPPLÉMENTAIRES, majorées à la française :
 *     les 8 premières heures au-delà du contrat à +25 %, le reste à +50 %
 *     (règle légale par défaut, art. L3121-36 C. trav., base 35 h) ;
 *   • total < contrat → heures de RÉCUPÉRATION (solde à rattraper / posé).
 * `majEquivMin` = équivalent payé des heures supp (25 % → ×1,25 ; 50 % → ×1,5),
 * la donnée qu'attend la compta pour la paie.
 */

/* ─────────────────────────── Tags de journée ────────────────────────────────
 * Qualification RAPIDE d'un jour (remplace la note libre sur mobile) : Présent,
 * Absent, Congés, Récup, Maladie, Férié. Les tags « Congés » et « Férié »
 * COMPTENT COMME TRAVAILLÉ : une journée type est créditée dans les heures de
 * la semaine (un CP validé ou un jour férié chômé ne crée jamais de déficit —
 * le férié est DÛ et payé comme une journée type). Les autres tags n'ajoutent
 * pas d'heures (la récup se décompte du compteur au passage de la semaine,
 * cf. lib/planning). */
export type DayTag = "present" | "absent" | "conges" | "recup" | "maladie" | "ferie";

export const DAY_TAGS: DayTag[] = ["present", "absent", "conges", "recup", "maladie", "ferie"];

export const DAY_TAG_LABEL: Record<DayTag, string> = {
  present: "Présent",
  absent: "Absent",
  conges: "Congés",
  recup: "Récup",
  maladie: "Maladie",
  ferie: "Férié",
};

export function isDayTag(v: unknown): v is DayTag {
  return v === "present" || v === "absent" || v === "conges" || v === "recup" || v === "maladie" || v === "ferie";
}

/** Une journée saisie — plages matin (m1→m2) et après-midi (a1→a2), "HH:MM". */
export interface DayHours {
  m1?: string;
  m2?: string;
  a1?: string;
  a2?: string;
  /** Tag du jour (Présent / Absent / Congés / Récup / Maladie). */
  tag?: DayTag;
  /** Note du jour : précision libre (information compta) */
  note?: string;
}

/** Profil horaire d'un employé : contrat hebdo + journée type (préremplissage). */
export interface HoursProfile {
  weeklyHours: number;    // heures contractuelles / semaine (ex. 35, 39) — BASE LÉGALE des majorations 25/50
  typicalDay: DayHours;   // « journée type » appliquée d'un clic sur Lun→Ven
  /** Heures PAYÉES / semaine quand le contrat inclut des heures supp
   *  STRUCTURELLES payées d'office (ex. « contrat 42 h » = 35 h + 7 h supp
   *  payées chaque semaine). Ces 7 h sont TOUJOURS payées — jamais arbitrables
   *  (ni récup, ni décision). Seul le dépassement AU-DELÀ de `paidWeeklyHours`
   *  part au choix récup/paiement. null/absent ou ≤ `weeklyHours` = pas d'heures
   *  supp structurelles (paie = contrat). */
  paidWeeklyHours?: number | null;
  /** Solde annuel de congés payés (jours) attribué par l'employeur — période
   *  de référence 1er juin → 31 mai. Utilisé UNIQUEMENT en repli, quand aucun
   *  cumul (`cpAnchorDate`) n'est défini. null/absent = non défini. */
  cpAllowanceDays?: number | null;
  /** CUMUL PERMANENT des CP (pas de période de référence) : le solde s'acquiert
   *  au fil de l'eau, `cpAccrualPerMonth` jours ouvrables par mois. Point
   *  d'ancrage = solde CONNU (`cpAnchorDays`) à une date (`cpAnchorDate`) ; le
   *  compteur vaut alors `cpAnchorDays + cpAccrualPerMonth × mois écoulés depuis
   *  l'ancrage − CP pris depuis l'ancrage`. `cpAnchorDate` absent → on retombe
   *  sur le solde annuel `cpAllowanceDays` (ancien modèle). */
  cpAnchorDate?: string | null;      // YYYY-MM-DD
  cpAnchorDays?: number | null;      // solde CP (jours) à la date d'ancrage
  cpAccrualPerMonth?: number | null; // jours ouvrables acquis / mois (défaut 2,5)
  /** Plafond du compteur de récup (heures) fixé par l'employeur : les heures
   *  supp AU-DELÀ partent au PAIEMENT sur le bulletin du mois suivant (reporté
   *  sur l'état compta). null/absent = pas de plafond. */
  recupCapHours?: number | null;
  /** Initiales affichées (3 lettres max, ex. « MM », « JMG ») — calendrier
   *  d'équipe sur MOBILE. null/absent = dérivées du nom. */
  initials?: string | null;
}

export const DEFAULT_PROFILE: HoursProfile = {
  weeklyHours: 35,
  typicalDay: { m1: "06:00", m2: "13:00" },   // 7 h × 5 jours = 35 h
};

export const JOURS_SEMAINE = ["Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi", "Samedi", "Dimanche"] as const;

/** Tranche à +25 % : les 8 premières heures au-delà du contrat (puis +50 %). */
const SUP25_BAND_MIN = 8 * 60;

/** "HH:MM" → minutes depuis minuit, null si vide/invalide. */
export function parseHM(s: string | undefined | null): number | null {
  const t = (s ?? "").trim();
  if (!t) return null;
  const m = /^(\d{1,2}):(\d{2})$/.exec(t);
  if (!m) return null;
  const h = Number(m[1]), mn = Number(m[2]);
  if (h > 23 || mn > 59) return null;
  return h * 60 + mn;
}

/** Minutes travaillées d'une journée — chaque plage (matin / après-midi) doit
 *  être complète et cohérente (fin > début) pour compter ; sinon ignorée. */
export function dayMinutes(d: DayHours | undefined | null): number {
  if (!d) return 0;
  let total = 0;
  for (const [from, to] of [[d.m1, d.m2], [d.a1, d.a2]] as const) {
    const a = parseHM(from), b = parseHM(to);
    if (a != null && b != null && b > a) total += b - a;
  }
  return total;
}

export interface WeekCalc {
  dayMin: number[];       // minutes par jour (Lun→Dim), crédit congés inclus
  totalMin: number;       // total travaillé (crédits congés + fériés inclus)
  contractMin: number;    // contrat hebdo
  deltaMin: number;       // total − contrat (négatif = récup)
  sup25Min: number;       // heures supp à +25 % (8 premières) — dépassement TRAVAILLÉ seulement
  sup50Min: number;       // heures supp à +50 % (au-delà) — dépassement TRAVAILLÉ seulement
  recupMin: number;       // heures de récupération (si total < contrat)
  majEquivMin: number;    // équivalent PAYÉ des heures supp (×1,25 / ×1,5)
  congesMin: number;      // minutes CRÉDITÉES par les jours de congés (journée type)
  ferieMin: number;       // minutes CRÉDITÉES par les jours fériés chômés (journée type — TOUJOURS payées, jamais en récup)
  recupCreditMin: number; // minutes de RÉCUP posée CRÉDITÉES dans le total (= récup consommée du compteur ; bornée au déficit)
}

/** Minutes de la « journée type » du profil ; repli = contrat / 5 jours.
 *  C'est la valeur créditée pour un jour de CONGÉS (compté comme travaillé). */
export function typicalDayMinutes(profile: Pick<HoursProfile, "weeklyHours" | "typicalDay">): number {
  const t = dayMinutes(profile.typicalDay);
  if (t > 0) return t;
  return Math.max(0, Math.round(((profile.weeklyHours || 0) * 60) / 5));
}

/** Calcule la semaine : total, écart au contrat, ventilation 25/50, récup.
 *  `typicalDayMin` > 0 → chaque jour taggé « congés » ou « férié » SANS heures
 *  saisies est crédité d'une journée type (le CP compte comme travaillé, le
 *  férié chômé est DÛ — jamais de déficit créé par un congé validé ni par un
 *  jour férié).
 *
 *  JOUR FÉRIÉ « FORCÉMENT PAYÉ » : la part du dépassement attribuable au crédit
 *  férié est payée telle quelle (heures normales, détaillées à part dans
 *  `ferieMin`) et n'entre JAMAIS dans les heures supp arbitrables — les
 *  majorations 25/50 ne portent que sur le dépassement réellement TRAVAILLÉ.
 *  Ex. contrat 35 h, 37h45 travaillées + férié 7h15 crédité (total 45h00) →
 *  supp arbitrables 2h45 (récup/paiement), férié 7h15 payé quoi qu'il arrive.
 *
 *  JOUR de RÉCUP POSÉ (tag « récup ») : il CRÉDITE une journée type dans le
 *  total (le repos compensateur est du temps PAYÉ), mais BORNÉ AU DÉFICIT au
 *  contrat — si la semaine atteint déjà le contrat par le travail réel, la
 *  récup n'est PAS consommée (crédit 0 → re-créditée au compteur). Le crédit
 *  vaut exactement la récup débitée du compteur (`recupCreditMin`). Ex.
 *  contrat 35 h, 4 j travaillés = 27h45 + 1 j récup 7h15 → total 35h00, récup
 *  consommée 7h15 ; si les 4 j font 30h → total 35h00 mais récup consommée 5h
 *  seulement (2h15 re-créditées, car il a fait plus que 35 h − 7h15). */
export function computeWeek(
  days: (DayHours | undefined)[],
  weeklyHours: number,
  typicalDayMin = 0,
): WeekCalc {
  let congesMin = 0;
  let ferieMin = 0;
  const recupIdx: number[] = [];
  const dayMin = Array.from({ length: 7 }, (_, i) => {
    const d = days[i];
    const worked = dayMinutes(d);
    if (worked === 0 && d?.tag === "conges" && typicalDayMin > 0) {
      congesMin += typicalDayMin;
      return typicalDayMin;
    }
    if (worked === 0 && d?.tag === "ferie" && typicalDayMin > 0) {
      ferieMin += typicalDayMin;
      return typicalDayMin;
    }
    // Jour de récup posé : crédité plus bas (borné au déficit), 0 pour l'instant.
    if (worked === 0 && d?.tag === "recup" && typicalDayMin > 0) {
      recupIdx.push(i);
      return 0;
    }
    return worked;
  });
  const contractMin = Math.max(0, Math.round((weeklyHours || 0) * 60));
  // Total AVANT récup (travail réel + congés + fériés) → déficit à combler.
  const baseTotalMin = dayMin.reduce((s, m) => s + m, 0);
  // RÉCUP POSÉE : chaque jour comble le déficit à hauteur d'une journée type,
  // sans jamais dépasser le contrat (le surplus de travail « rend » la récup).
  let recupCreditMin = 0;
  let gap = Math.max(0, contractMin - baseTotalMin);
  for (const i of recupIdx) {
    const credit = Math.min(typicalDayMin, gap);
    dayMin[i] = credit;
    recupCreditMin += credit;
    gap -= credit;
  }
  const totalMin = baseTotalMin + recupCreditMin;
  const deltaMin = totalMin - contractMin;
  // Dépassement TRAVAILLÉ = dépassement total − part férié (forcément payée).
  const supMin = Math.max(0, Math.max(0, deltaMin) - ferieMin);
  const sup25Min = Math.min(supMin, SUP25_BAND_MIN);
  const sup50Min = Math.max(0, supMin - SUP25_BAND_MIN);
  const recupMin = Math.max(0, -deltaMin);
  const majEquivMin = Math.round(sup25Min * 1.25 + sup50Min * 1.5);
  return { dayMin, totalMin, contractMin, deltaMin, sup25Min, sup50Min, recupMin, majEquivMin, congesMin, ferieMin, recupCreditMin };
}

/** Minutes → « 38h30 » (signe conservé : −150 → « −2h30 »). */
export function fmtHM(min: number): string {
  const sign = min < 0 ? "−" : "";
  const abs = Math.abs(Math.round(min));
  const h = Math.floor(abs / 60);
  const m = abs % 60;
  return `${sign}${h}h${String(m).padStart(2, "0")}`;
}

/* ───────────────────── Option compta des heures supp ──────────────────────
 * Quand une semaine dépasse le contrat, l'employeur tranche : RÉCUPÉRATION
 * (repos compensateur, compté en JOURS — dates posées), PAIEMENT des heures
 * supp (majorées), ou MIXTE (une partie payée, le reste crédité en récup —
 * décision posée depuis le détail compta, au moment de générer le PDF). Le
 * choix, fait à la semaine, est reporté sur l'état mensuel (PDF) transmis à
 * la compta ET au salarié. */
export type HeuresOption = "recup" | "paiement" | "mixte";

/** Libellés canoniques — réutilisés à l'écran ET sur l'état PDF (une seule
 *  source de vérité, pas de reformulation divergente). */
export const HEURES_OPTION_LABEL: Record<HeuresOption, string> = {
  recup: "Récupération (en jours)",
  paiement: "Paiement des heures supp.",
  mixte: "Paiement partiel + récup",
};

/** Garde de type : `v` est-il une option valide ? */
export function isHeuresOption(v: unknown): v is HeuresOption {
  return v === "recup" || v === "paiement" || v === "mixte";
}

/** Ventilation d'un PARTAGE des heures supp entre paiement et récup. */
export interface SuppSplit {
  payMin: number;        // minutes de supp (brutes) PAYÉES
  recupMin: number;      // minutes de supp (brutes) laissées en RÉCUP
  payEquivMin: number;   // équivalent PAYÉ majoré de la part payée (×1,25 / ×1,5)
  recupEquivMin: number; // équivalent MAJORÉ crédité au compteur de récup
}

/**
 * Partage les heures supp d'une semaine entre PAIEMENT et RÉCUP.
 * `paySuppMin` = minutes de supp (brutes) que l'employeur paye ; le reste part
 * au compteur de récup (repos compensateur de remplacement — les majorations
 * suivent chaque part). La part payée consomme d'abord la tranche +25 % (les
 * premières heures au-delà du contrat), puis la tranche +50 %. Les équivalents
 * majorés se COMPLÈTENT exactement : payEquiv + recupEquiv = majEquiv total.
 */
export function splitSupp(sup25Min: number, sup50Min: number, paySuppMin: number): SuppSplit {
  const totalSupp = Math.max(0, sup25Min) + Math.max(0, sup50Min);
  const payMin = Math.max(0, Math.min(Math.round(paySuppMin), totalSupp));
  const pay25 = Math.min(payMin, Math.max(0, sup25Min));
  const pay50 = payMin - pay25;
  const payEquivMin = Math.round(pay25 * 1.25 + pay50 * 1.5);
  const majEquivMin = Math.round(Math.max(0, sup25Min) * 1.25 + Math.max(0, sup50Min) * 1.5);
  return {
    payMin,
    recupMin: totalSupp - payMin,
    payEquivMin,
    recupEquivMin: majEquivMin - payEquivMin,
  };
}

/** Part PAYÉE effective d'une semaine selon l'option retenue : « paiement » =
 *  tout payé, « recup »/aucune décision = rien, « mixte » = `paySuppMin` borné
 *  aux supp réelles. Le complément part au compteur de récup (semaines
 *  « recup »/« mixte » uniquement — sans décision, rien n'est crédité). */
export function effectivePaySuppMin(
  option: HeuresOption | null | undefined,
  paySuppMin: number | null | undefined,
  totalSuppMin: number,
): number {
  if (option === "paiement") return totalSuppMin;
  if (option === "mixte") return Math.max(0, Math.min(Math.round(paySuppMin ?? 0), totalSuppMin));
  return 0;
}

/* ─────────────── Heures supp STRUCTURELLES (contrat « 42 h » payé) ──────────
 * Certains contrats paient d'office un volume d'heures supp chaque semaine (ex.
 * 42 h = 35 h + 7 h supp payées). Ces heures ne sont JAMAIS arbitrées (toujours
 * payées, jamais en récup) ; seul le dépassement AU-DELÀ part au choix
 * récup/paiement. La base légale des majorations reste `weeklyHours` (35 h) :
 * les 7 h structurelles tombent dans la tranche +25 % comme n'importe quelle
 * heure supp — on les paie simplement d'office. */

/** Minutes d'heures supp STRUCTURELLES d'un profil = (heures payées − contrat),
 *  bornées ≥ 0. 0 si `paidWeeklyHours` absent/≤ contrat. */
export function structuralSuppMin(profile: Pick<HoursProfile, "weeklyHours" | "paidWeeklyHours">): number {
  const paid = profile.paidWeeklyHours;
  if (paid == null || !Number.isFinite(paid)) return 0;
  return Math.max(0, Math.round((paid - (profile.weeklyHours || 0)) * 60));
}

/** Répartition des heures supp d'une semaine entre part STRUCTURELLE (payée
 *  d'office) et part ARBITRABLE (récup/paiement). */
export interface SuppArbitrage {
  struct25Min: number;       // supp structurelle en tranche +25 %
  struct50Min: number;       // supp structurelle en tranche +50 % (rare)
  arb25Min: number;          // supp ARBITRABLE en tranche +25 %
  arb50Min: number;          // supp ARBITRABLE en tranche +50 %
  structEquivMin: number;    // équivalent PAYÉ des heures structurelles (toujours payé)
  arbitrableMin: number;     // total BRUT arbitrable (arb25 + arb50)
}

/**
 * Sépare les heures supp d'une semaine (`sup25Min` + `sup50Min`) en part
 * STRUCTURELLE (les `structFloorMin` premières minutes, payées d'office) et part
 * ARBITRABLE (le reste). La part structurelle consomme d'abord la tranche +25 %
 * (les heures les plus basses), puis la +50 %. `structFloorMin` = 0 → tout est
 * arbitrable (comportement historique, salarié sans heures structurelles).
 */
export function splitStructuralSupp(sup25Min: number, sup50Min: number, structFloorMin: number): SuppArbitrage {
  const s25 = Math.max(0, sup25Min), s50 = Math.max(0, sup50Min);
  const floor = Math.max(0, Math.min(Math.round(structFloorMin), s25 + s50));
  const struct25 = Math.min(floor, s25);
  const struct50 = floor - struct25;
  const arb25 = s25 - struct25, arb50 = s50 - struct50;
  return {
    struct25Min: struct25,
    struct50Min: struct50,
    arb25Min: arb25,
    arb50Min: arb50,
    structEquivMin: Math.round(struct25 * 1.25 + struct50 * 1.5),
    arbitrableMin: arb25 + arb50,
  };
}

/* ───────────────────────── Semaines ISO (Lun→Dim) ─────────────────────────── */

/** Date → identifiant de semaine ISO « 2026-W27 ». */
export function isoWeekId(date: Date): string {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dow = d.getUTCDay() || 7;             // Lun=1 … Dim=7
  d.setUTCDate(d.getUTCDate() + 4 - dow);     // jeudi de la semaine ISO
  const year = d.getUTCFullYear();
  const jan1 = new Date(Date.UTC(year, 0, 1));
  const week = Math.ceil(((d.getTime() - jan1.getTime()) / 86_400_000 + 1) / 7);
  return `${year}-W${String(week).padStart(2, "0")}`;
}

/** Identifiant valide ? (année plausible + semaine 01–53) */
export function isWeekId(id: string): boolean {
  const m = /^(\d{4})-W(\d{2})$/.exec(id);
  if (!m) return false;
  const w = Number(m[2]);
  return w >= 1 && w <= 53;
}

/** Les 7 dates (Lun→Dim) d'une semaine ISO, en ISO « YYYY-MM-DD ». */
export function weekDates(weekId: string): string[] {
  const m = /^(\d{4})-W(\d{2})$/.exec(weekId);
  if (!m) return [];
  const year = Number(m[1]), week = Number(m[2]);
  // Le 4 janvier est TOUJOURS en semaine ISO 1 → lundi de W1, puis décalage.
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const monday = new Date(jan4);
  monday.setUTCDate(jan4.getUTCDate() - ((jan4.getUTCDay() || 7) - 1) + (week - 1) * 7);
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(monday);
    d.setUTCDate(monday.getUTCDate() + i);
    return d.toISOString().slice(0, 10);
  });
}

/** Semaine décalée de `delta` (±1 = semaine précédente/suivante). */
export function shiftWeek(weekId: string, delta: number): string {
  const dates = weekDates(weekId);
  if (dates.length === 0) return weekId;
  const monday = new Date(`${dates[0]}T12:00:00Z`);
  monday.setUTCDate(monday.getUTCDate() + delta * 7);
  return isoWeekId(new Date(monday.getUTCFullYear(), monday.getUTCMonth(), monday.getUTCDate()));
}

/** La date ISO « YYYY-MM-DD » tombe-t-elle dans la semaine ISO (Lun→Dim) ?
 *  Sert à INTERDIRE une récup posée dans la semaine même des heures supp :
 *  on ne récupère pas une semaine déjà à/au-delà du contrat. */
export function isDateInWeek(dateISO: string, weekId: string): boolean {
  const d = weekDates(weekId);
  return d.length === 7 && dateISO >= d[0] && dateISO <= d[6];
}

/** Les `count` jours calendaires qui SUIVENT la semaine (à partir du lendemain
 *  du dimanche) — propositions de jours de récup HORS de la semaine des supp.
 *  ISO « YYYY-MM-DD ». */
export function daysAfterWeek(weekId: string, count: number): string[] {
  const dates = weekDates(weekId);
  if (dates.length !== 7 || count <= 0) return [];
  const sunday = new Date(`${dates[6]}T12:00:00Z`);
  return Array.from({ length: count }, (_, i) => {
    const d = new Date(sunday);
    d.setUTCDate(sunday.getUTCDate() + i + 1);
    return d.toISOString().slice(0, 10);
  });
}

/* ───────────────────────── Mois (état MENSUEL compta) ─────────────────────────
 * La saisie et le calcul des heures supp restent HEBDOMADAIRES (règle légale :
 * les majorations s'apprécient à la semaine civile). L'état transmis à la
 * compta est MENSUEL : un mois regroupe les semaines ISO dont le DIMANCHE
 * tombe dans le mois — une semaine à cheval sur deux mois est donc rattachée
 * au mois où elle se termine (ses heures supp partent dans le mois suivant,
 * compatible avec une paie au 10). */

/** Identifiant de mois « YYYY-MM » valide ? */
export function isMonthId(id: string): boolean {
  const m = /^(\d{4})-(\d{2})$/.exec(id);
  if (!m) return false;
  const mm = Number(m[2]);
  return mm >= 1 && mm <= 12;
}

/** Mois d'une date → « YYYY-MM ». */
export function monthIdOf(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

/** Mois décalé de `delta` (±1 = mois précédent/suivant). */
export function shiftMonth(monthId: string, delta: number): string {
  const m = /^(\d{4})-(\d{2})$/.exec(monthId);
  if (!m) return monthId;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** Libellé « juillet 2026 ». */
export function monthLabel(monthId: string): string {
  const m = /^(\d{4})-(\d{2})$/.exec(monthId);
  if (!m) return monthId;
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, 15)).toLocaleDateString("fr-FR", {
    timeZone: "UTC", month: "long", year: "numeric",
  });
}

/** Semaines ISO RATTACHÉES au mois = celles dont le DIMANCHE est dans le mois
 *  (ordre chronologique). */
export function monthWeeks(monthId: string): string[] {
  const m = /^(\d{4})-(\d{2})$/.exec(monthId);
  if (!m) return [];
  const year = Number(m[1]), month = Number(m[2]);
  const out: string[] = [];
  // Tous les dimanches du mois → leur semaine ISO.
  const d = new Date(Date.UTC(year, month - 1, 1));
  while (d.getUTCMonth() === month - 1) {
    if (d.getUTCDay() === 0) {
      out.push(isoWeekId(new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())));
    }
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}

/** Agrégat MENSUEL : somme des calculs hebdomadaires (les majorations restent
 *  calculées semaine par semaine — on n'additionne que les résultats). */
export interface MonthCalc {
  totalMin: number;
  contractMin: number;
  deltaMin: number;
  sup25Min: number;
  sup50Min: number;
  recupMin: number;
  majEquivMin: number;
  congesMin: number;
  ferieMin: number;
  recupCreditMin: number;
  weeksWithData: number;
}

export function aggregateMonth(weekCalcs: (WeekCalc | null | undefined)[]): MonthCalc {
  const agg: MonthCalc = { totalMin: 0, contractMin: 0, deltaMin: 0, sup25Min: 0, sup50Min: 0, recupMin: 0, majEquivMin: 0, congesMin: 0, ferieMin: 0, recupCreditMin: 0, weeksWithData: 0 };
  for (const c of weekCalcs) {
    if (!c) continue;
    agg.totalMin += c.totalMin;
    agg.contractMin += c.contractMin;
    agg.deltaMin += c.deltaMin;
    agg.sup25Min += c.sup25Min;
    agg.sup50Min += c.sup50Min;
    agg.recupMin += c.recupMin;
    agg.majEquivMin += c.majEquivMin;
    agg.congesMin += c.congesMin ?? 0;
    agg.ferieMin += c.ferieMin ?? 0;
    agg.recupCreditMin += c.recupCreditMin ?? 0;
    agg.weeksWithData += 1;
  }
  return agg;
}

/** Libellé lisible : « Semaine 27 · 29 juin – 5 juillet 2026 ». */
export function weekLabel(weekId: string): string {
  const dates = weekDates(weekId);
  const m = /^(\d{4})-W(\d{2})$/.exec(weekId);
  if (dates.length === 0 || !m) return weekId;
  const fmt = (iso: string, opts: Intl.DateTimeFormatOptions) =>
    new Date(`${iso}T12:00:00Z`).toLocaleDateString("fr-FR", { timeZone: "UTC", ...opts });
  return `Semaine ${Number(m[2])} · ${fmt(dates[0], { day: "numeric", month: "long" })} – ${fmt(dates[6], { day: "numeric", month: "long", year: "numeric" })}`;
}
