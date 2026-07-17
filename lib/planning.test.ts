import { describe, it, expect } from "vitest";
import {
  expandDates, expandOuvrables, expandSemaine, monthGridDays, isoWeekOfDate,
  computeRecupCounter, recupCapExcessMin, cpPeriodOf, computeCpCounter,
  computeMonthRecap, monthEndISO, dayAfter, congeCreditsHours,
  resolveCalendarDay, DAY_CATEGORY_LABEL, saturdaysInRange, splitLeaveRecupCp,
  type CounterWeekInput,
} from "./planning";
import { computeWeek, type DayHours } from "./heuresCalc";

/** Journée de `h` heures à partir de 06:00. */
const day = (h: number): DayHours => ({ m1: "06:00", m2: `${String(6 + h).padStart(2, "0")}:00` });
const PROFILE = { weeklyHours: 35, typicalDay: { m1: "06:00", m2: "13:00" } }; // journée type 7 h

describe("planning — expansion de plages", () => {
  it("expandDates inclut début et fin", () => {
    expect(expandDates("2026-07-06", "2026-07-08")).toEqual(["2026-07-06", "2026-07-07", "2026-07-08"]);
    expect(expandDates("2026-07-08", "2026-07-06")).toEqual([]);
  });
  it("expandOuvrables retire les dimanches (lun→sam)", () => {
    // Semaine 2026-W28 : lundi 6 → dimanche 12 juillet.
    expect(expandOuvrables("2026-07-06", "2026-07-12")).toHaveLength(6);
  });
  it("expandSemaine garde lun→ven (jours crédités d'une journée type)", () => {
    expect(expandSemaine("2026-07-06", "2026-07-12")).toHaveLength(5);
  });
});

describe("planning — grille du calendrier mensuel", () => {
  it("juillet 2026 : du lundi 29 juin au dimanche 2 août (semaines pleines)", () => {
    const grid = monthGridDays("2026-07");
    expect(grid[0]).toEqual({ date: "2026-06-29", inMonth: false });
    expect(grid[grid.length - 1]).toEqual({ date: "2026-08-02", inMonth: false });
    expect(grid.length % 7).toBe(0);
    expect(grid.filter((g) => g.inMonth)).toHaveLength(31);
  });
  it("isoWeekOfDate suit la semaine ISO", () => {
    expect(isoWeekOfDate("2026-07-06")).toBe("2026-W28");
    expect(isoWeekOfDate("2026-07-12")).toBe("2026-W28");
    expect(isoWeekOfDate("2026-07-13")).toBe("2026-W29");
  });
});

describe("planning — crédit congés dans computeWeek (journée type)", () => {
  it("un jour taggé « congés » sans heures est crédité d'une journée type", () => {
    const days: DayHours[] = [day(7), day(7), day(7), day(7), { tag: "conges" }, {}, {}];
    const c = computeWeek(days, 35, 7 * 60);
    expect(c.totalMin).toBe(35 * 60);        // 4 jours travaillés + 1 CP crédité
    expect(c.congesMin).toBe(7 * 60);
    expect(c.deltaMin).toBe(0);              // le CP ne crée AUCUN déficit
    expect(c.recupMin).toBe(0);
  });
  it("un jour taggé « congés » AVEC heures saisies n'est pas doublé", () => {
    const days: DayHours[] = [{ ...day(7), tag: "conges" }, {}, {}, {}, {}, {}, {}];
    const c = computeWeek(days, 35, 7 * 60);
    expect(c.dayMin[0]).toBe(7 * 60);
    expect(c.congesMin).toBe(0);
  });
  it("sans journée type fournie, aucun crédit (rétro-compatible)", () => {
    const c = computeWeek([{ tag: "conges" }, {}, {}, {}, {}, {}, {}], 35);
    expect(c.totalMin).toBe(0);
    expect(c.congesMin).toBe(0);
  });
  it("les tags absent / maladie ne créditent rien", () => {
    const days: DayHours[] = [{ tag: "absent" }, { tag: "maladie" }, {}, {}, {}, {}, {}];
    const c = computeWeek(days, 35, 7 * 60);
    expect(c.totalMin).toBe(0);
    expect(c.recupCreditMin).toBe(0);
  });
});

describe("planning — crédit RÉCUP dans computeWeek (bornée au déficit)", () => {
  const TYP = 7 * 60 + 15;   // journée type 7h15

  it("jour de récup posé : crédité d'une journée type quand la semaine est en déficit", () => {
    // 4 jours travaillés 7h15 = 29h00 + 1 jour récup → total ramené vers le contrat.
    const d = (): DayHours => ({ m1: "04:45", m2: "12:00" });   // 7h15
    const days: DayHours[] = [d(), d(), d(), d(), { tag: "recup" }, {}, {}];
    const c = computeWeek(days, 35, TYP);
    // 29h00 travaillées + récup pour combler jusqu'à 35h = 6h00 créditées (borné au déficit).
    expect(c.recupCreditMin).toBe(6 * 60);
    expect(c.totalMin).toBe(35 * 60);
    expect(c.deltaMin).toBe(0);
    expect(c.sup25Min).toBe(0);
  });

  it("contrat atteint par le travail réel → récup NON consommée (crédit 0)", () => {
    // 5 jours travaillés 7h00 = 35h00 + 1 samedi récup → déficit 0, récup re-créditée.
    const d = (): DayHours => ({ m1: "06:00", m2: "13:00" });   // 7h00
    const days: DayHours[] = [d(), d(), d(), d(), d(), { tag: "recup" }, {}];
    const c = computeWeek(days, 35, TYP);
    expect(c.recupCreditMin).toBe(0);
    expect(c.totalMin).toBe(35 * 60);
  });

  it("sur-travail partiel : seule la part nécessaire est consommée (le reste re-crédité)", () => {
    // 4 jours à 7h30 = 30h00 + 1 jour récup. Déficit = 5h00 → récup consommée 5h00
    // (2h15 « rendues » car il a fait plus que 35h − 7h15).
    const d = (): DayHours => ({ m1: "06:00", m2: "13:30" });   // 7h30
    const days: DayHours[] = [d(), d(), d(), d(), { tag: "recup" }, {}, {}];
    const c = computeWeek(days, 35, TYP);
    expect(c.recupCreditMin).toBe(5 * 60);
    expect(c.totalMin).toBe(35 * 60);
  });

  it("sans journée type fournie, aucun crédit récup (rétro-compatible)", () => {
    const c = computeWeek([{ tag: "recup" }, {}, {}, {}, {}, {}, {}], 35);
    expect(c.recupCreditMin).toBe(0);
    expect(c.totalMin).toBe(0);
  });
});

describe("planning — compteur récup (décompte au passage de la semaine)", () => {
  // 2026-W27 = 29 juin → 5 juillet ; 2026-W28 = 6 → 12 juillet.
  const ASOF = "2026-07-11"; // W27 terminée, W28 en cours

  it("crédit MAJORÉ : semaine à 39 h en option récup → +4 h supp × 1,25 = +5 h", () => {
    const weeks: CounterWeekInput[] = [
      { week: "2026-W27", days: [day(8), day(8), day(8), day(8), day(7)], option: "recup" },
    ];
    const c = computeRecupCounter(weeks, [], PROFILE, ASOF);
    expect(c.creditMin).toBe(5 * 60);   // 4 h supp, toutes à +25 % → 5 h de récup
    expect(c.debitMin).toBe(0);
    expect(c.balanceMin).toBe(5 * 60);
  });

  it("pas de crédit tant que la semaine n'est pas passée", () => {
    const weeks: CounterWeekInput[] = [
      { week: "2026-W28", days: [day(9), day(9), day(9), day(9), day(9)], option: "recup" },
    ];
    const c = computeRecupCounter(weeks, [], PROFILE, ASOF);
    expect(c.creditMin).toBe(0);
  });

  it("débit : récup posée, semaine finie en déficit → min(déficit, jours × journée type)", () => {
    const weeks: CounterWeekInput[] = [
      // W27 : 4 jours de 7 h + vendredi taggé récup → 28 h, déficit 7 h.
      { week: "2026-W27", days: [day(7), day(7), day(7), day(7), { tag: "recup" }, {}, {}], option: null },
    ];
    const c = computeRecupCounter(weeks, [], PROFILE, ASOF);
    expect(c.debitMin).toBe(7 * 60);
  });

  it("RÈGLE CLÉ : contrat atteint malgré la récup → RIEN n'est déduit", () => {
    const weeks: CounterWeekInput[] = [
      // W27 : 5 jours de 7 h faits QUAND MÊME + samedi taggé récup → 35 h, déficit 0.
      { week: "2026-W27", days: [day(7), day(7), day(7), day(7), day(7), { tag: "recup" }, {}], option: null },
    ];
    const c = computeRecupCounter(weeks, [], PROFILE, ASOF);
    expect(c.debitMin).toBe(0);
    expect(c.balanceMin).toBe(0);
  });

  it("débit borné par les jours posés (déficit plus grand → pas sur-déduit)", () => {
    const weeks: CounterWeekInput[] = [
      // W27 : 3 jours de 7 h + 1 jour récup → 21 h, déficit 14 h, mais 1 seul jour posé.
      { week: "2026-W27", days: [day(7), day(7), day(7), { tag: "recup" }, {}, {}, {}], option: null },
    ];
    const c = computeRecupCounter(weeks, [], PROFILE, ASOF);
    expect(c.debitMin).toBe(7 * 60);
  });

  it("semaine passée SANS saisie : la récup posée (boomerang) est réputée prise", () => {
    const c = computeRecupCounter([], ["2026-07-03"], PROFILE, ASOF); // vendredi W27
    expect(c.debitMin).toBe(7 * 60);
  });

  it("récup posée dans une semaine À VENIR : pas encore décomptée, listée « à venir »", () => {
    const c = computeRecupCounter([], ["2026-07-17"], PROFILE, ASOF); // vendredi W29
    expect(c.debitMin).toBe(0);
    expect(c.plannedDates).toEqual(["2026-07-17"]);
  });

  it("recupDates posées depuis la semaine des supp pointent vers d'autres semaines", () => {
    const weeks: CounterWeekInput[] = [
      // W26 (22–28 juin) : 39 h option récup, récup posée le vendredi de W27.
      { week: "2026-W26", days: [day(8), day(8), day(8), day(8), day(7)], option: "recup", recupDates: ["2026-07-03"] },
    ];
    const c = computeRecupCounter(weeks, [], PROFILE, ASOF);
    expect(c.creditMin).toBe(5 * 60);   // 4 h supp majorées (+25 %) = 5 h
    expect(c.debitMin).toBe(7 * 60);   // W27 passée sans saisie → journée réputée prise
  });

  it("option MIXTE : seule la part NON payée est créditée (majorée)", () => {
    const weeks: CounterWeekInput[] = [
      // W27 : 45 h → 10 h supp (équiv. majoré 13 h). 4 h payées (tranche +25 %
      // d'abord → équiv. payé 5 h) → crédit récup = 13 − 5 = 8 h.
      { week: "2026-W27", days: [day(9), day(9), day(9), day(9), day(9)], option: "mixte", paySuppMin: 4 * 60 },
    ];
    const c = computeRecupCounter(weeks, [], PROFILE, ASOF);
    expect(c.creditMin).toBe(8 * 60);
  });

  it("option MIXTE sans part payée renseignée = tout en récup ; payée ≥ supp = rien", () => {
    const w45 = [day(9), day(9), day(9), day(9), day(9)];
    expect(computeRecupCounter([{ week: "2026-W27", days: w45, option: "mixte" }], [], PROFILE, ASOF).creditMin).toBe(13 * 60);
    expect(computeRecupCounter([{ week: "2026-W27", days: w45, option: "mixte", paySuppMin: 15 * 60 }], [], PROFILE, ASOF).creditMin).toBe(0);
  });

  it("option PAIEMENT : rien n'est crédité au compteur", () => {
    const weeks: CounterWeekInput[] = [
      { week: "2026-W27", days: [day(9), day(9), day(9), day(9), day(9)], option: "paiement" },
    ];
    expect(computeRecupCounter(weeks, [], PROFILE, ASOF).creditMin).toBe(0);
  });
});

describe("planning — plafond récup → paiement M+1", () => {
  it("excédent au-delà du plafond", () => {
    expect(recupCapExcessMin(10 * 60, 7)).toBe(3 * 60);
    expect(recupCapExcessMin(5 * 60, 7)).toBe(0);
    expect(recupCapExcessMin(10 * 60, null)).toBe(0);   // pas de plafond défini
    expect(recupCapExcessMin(10 * 60, 0)).toBe(10 * 60); // plafond 0 = tout payé
  });
});

describe("planning — compteur CP (période 1er juin → 31 mai)", () => {
  it("période de référence", () => {
    expect(cpPeriodOf("2026-07-11")).toEqual({ start: "2026-06-01", end: "2027-05-31" });
    expect(cpPeriodOf("2026-03-01")).toEqual({ start: "2025-06-01", end: "2026-05-31" });
  });
  it("jours ouvrables décomptés (dimanche gratuit), pending séparé", () => {
    const conges = [
      { type: "cp" as const, status: "approved" as const, start: "2026-07-06", end: "2026-07-12" }, // 6 ouvrables
      { type: "cp" as const, status: "pending" as const, start: "2026-08-03", end: "2026-08-04" },  // 2 ouvrables
      { type: "recup" as const, status: "approved" as const, start: "2026-07-20", end: "2026-07-20" }, // ignoré (pas CP)
      { type: "cp" as const, status: "approved" as const, start: "2026-04-01", end: "2026-04-02" }, // hors période
    ];
    const c = computeCpCounter(25, conges, "2026-07-11");
    expect(c.takenDays).toBe(6);
    expect(c.pendingDays).toBe(2);
    expect(c.balanceDays).toBe(19);
  });
  it("solde non défini par l'employeur → balance null", () => {
    const c = computeCpCounter(null, [], "2026-07-11");
    expect(c.allowanceDays).toBeNull();
    expect(c.balanceDays).toBeNull();
  });
});

describe("planning — récap mensuel (état compta)", () => {
  it("monthEndISO / dayAfter", () => {
    expect(monthEndISO("2026-07")).toBe("2026-07-31");
    expect(dayAfter("2026-07-31")).toBe("2026-08-01");
    expect(monthEndISO("2026-02")).toBe("2026-02-28");
  });
  it("solde fin de mois + excédent plafond reporté au paiement", () => {
    const weeks: CounterWeekInput[] = [
      { week: "2026-W27", days: [day(9), day(9), day(9), day(9), day(9)], option: "recup" }, // 45 h → 10 h supp
    ];
    const recap = computeMonthRecap(weeks, [], [], { ...PROFILE, recupCapHours: 7, cpAllowanceDays: 25 }, "2026-07");
    // 10 h supp = 8 h à +25 % (→10 h) + 2 h à +50 % (→3 h) = 13 h de récup MAJORÉE.
    expect(recap.recupBalanceMin).toBe(13 * 60);
    expect(recap.recupCapMin).toBe(7 * 60);
    expect(recap.excessMin).toBe(6 * 60);    // 13 − 7 = 6 h à payer sur le bulletin du mois suivant
    expect(recap.cpBalanceDays).toBe(25);
  });
  it("récup posée à venir + demandes en attente exposées (garde-fou du détail compta)", () => {
    const weeks: CounterWeekInput[] = [
      { week: "2026-W27", days: [day(9), day(9), day(9), day(9), day(9)], option: "recup" },
    ];
    const conges = [
      // Récup validée fin août (semaines APRÈS la fin du mois) → « posée à venir ».
      { type: "recup" as const, status: "approved" as const, start: "2026-08-24", end: "2026-08-25" },
      // Récup demandée (pending) : 2 jours de contrat — pas encore au compteur.
      { type: "recup" as const, status: "pending" as const, start: "2026-08-27", end: "2026-08-28" },
    ];
    const recap = computeMonthRecap(weeks, ["2026-08-24", "2026-08-25"], conges, PROFILE, "2026-07");
    expect(recap.plannedRecupDates).toEqual(["2026-08-24", "2026-08-25"]);
    expect(recap.pendingRecupDays).toBe(2);
  });
  it("congeCreditsHours : seuls les CP créditent des heures", () => {
    expect(congeCreditsHours("cp")).toBe(true);
    expect(congeCreditsHours("recup")).toBe(false);
    expect(congeCreditsHours("maladie")).toBe(false);
  });
});

describe("planning — pastille du calendrier (resolveCalendarDay)", () => {
  // 2026-07-13 = lundi (jour ouvré), 2026-07-18 = samedi, 2026-07-14 = férié.
  const MON = 1, SAT = 6, SUN = 0;

  it("PRÉSENT par défaut : jour ouvré (lun→ven) du mois, rien d'autre posé", () => {
    const r = resolveCalendarDay({ dow: MON, inMonth: true });
    expect(r.category).toBe("present");
    expect(r.pending).toBe(false);
  });
  it("samedi : PRÉSENT par défaut (jour travaillé dans l'entreprise)", () => {
    expect(resolveCalendarDay({ dow: SAT, inMonth: true }).category).toBe("present");
  });
  it("dimanche : aucune pastille par défaut (seul jour chômé)", () => {
    expect(resolveCalendarDay({ dow: SUN, inMonth: true }).category).toBeNull();
  });
  it("hors mois : aucune pastille par défaut (jour ouvré compris)", () => {
    expect(resolveCalendarDay({ dow: MON, inMonth: false }).category).toBeNull();
  });
  it("férié : prioritaire (jour chômé), même un jour ouvré", () => {
    const r = resolveCalendarDay({ dow: MON, inMonth: true, ferieLabel: "Fête nationale" });
    expect(r.category).toBe("ferie");
    expect(r.ferieLabel).toBe("Fête nationale");
  });
  it("férié l'emporte sur un congé validé", () => {
    const r = resolveCalendarDay({ dow: MON, inMonth: true, ferieLabel: "Noël", approvedTypes: ["cp"] });
    expect(r.category).toBe("ferie");
  });
  it("congé validé remplace le présent par défaut", () => {
    expect(resolveCalendarDay({ dow: MON, inMonth: true, approvedTypes: ["cp"] }).category).toBe("cp");
    expect(resolveCalendarDay({ dow: MON, inMonth: true, approvedTypes: ["recup"] }).category).toBe("recup");
  });
  it("tag de feuille d'heures : « conges » → catégorie conges, sinon tel quel", () => {
    expect(resolveCalendarDay({ dow: MON, inMonth: true, tag: "maladie" }).category).toBe("maladie");
    expect(resolveCalendarDay({ dow: MON, inMonth: true, tag: "absent" }).category).toBe("absent");
    expect(resolveCalendarDay({ dow: MON, inMonth: true, tag: "conges" }).category).toBe("conges");
    expect(resolveCalendarDay({ dow: MON, inMonth: true, tag: "present" }).category).toBe("present");
  });
  it("congé en attente : pastille creuse (pending)", () => {
    const r = resolveCalendarDay({ dow: MON, inMonth: true, pendingTypes: ["cp"] });
    expect(r.category).toBe("cp");
    expect(r.pending).toBe(true);
  });
  it("congé validé prime sur un congé en attente le même jour", () => {
    const r = resolveCalendarDay({ dow: MON, inMonth: true, approvedTypes: ["cp"], pendingTypes: ["maladie"] });
    expect(r.category).toBe("cp");
    expect(r.pending).toBe(false);
  });
  it("récup posée (à venir) : catégorie récup, marquée planned", () => {
    const r = resolveCalendarDay({ dow: SAT, inMonth: true, recupPosee: true });
    expect(r.category).toBe("recup");
    expect(r.planned).toBe(true);
  });
  it("libellés courts : CP pour congés payés", () => {
    expect(DAY_CATEGORY_LABEL.cp).toBe("CP");
    expect(DAY_CATEGORY_LABEL.present).toBe("Présent");
    expect(DAY_CATEGORY_LABEL.ferie).toBe("Férié");
  });
});

describe("planning — CP ne décompte ni dimanches ni fériés", () => {
  it("expandOuvrables exclut un jour férié dans la plage (14 juillet)", () => {
    // 13 lun, 14 mar (Fête nationale), 15 mer 2026 → seuls le 13 et le 15.
    const out = expandOuvrables("2026-07-13", "2026-07-15");
    expect(out).toEqual(["2026-07-13", "2026-07-15"]);
    expect(out).not.toContain("2026-07-14");
  });
  it("computeCpCounter ne débite pas le férié compris dans un CP", () => {
    const conges = [
      { type: "cp" as const, status: "approved" as const, start: "2026-07-13", end: "2026-07-15" }, // 14 férié
    ];
    const cp = computeCpCounter(25, conges, "2026-07-20");
    expect(cp.takenDays).toBe(2);       // 13 + 15 (le 14 juillet ne compte pas)
    expect(cp.balanceDays).toBe(23);
  });
  it("saturdaysInRange repère un samedi ouvré (coûte un CP à vide)", () => {
    // 10 ven, 11 sam juillet 2026 (samedi non férié).
    expect(saturdaysInRange("2026-07-10", "2026-07-11")).toEqual(["2026-07-11"]);
  });
  it("saturdaysInRange ignore un samedi férié (déjà non décompté)", () => {
    // 1er mai 2027 = samedi ET Fête du Travail → rien à « éviter ».
    expect(saturdaysInRange("2027-04-30", "2027-05-01")).toEqual([]);
    expect(expandOuvrables("2027-04-30", "2027-05-01")).toEqual(["2027-04-30"]);
  });
});

describe("planning — récup : seuls les jours ouvrés (lun→ven) décomptent", () => {
  const ASOF = "2026-07-13"; // W28 (6→12 juillet) terminée
  const day = (h: number): DayHours => ({ m1: "06:00", m2: `${String(6 + h).padStart(2, "0")}:00` });

  it("Ven+Sam SANS saisie → ne décompte QUE le vendredi (7h, pas 14h)", () => {
    // 2026-07-10 = ven, 2026-07-11 = sam (W28).
    const c = computeRecupCounter([], ["2026-07-10", "2026-07-11"], PROFILE, ASOF);
    expect(c.debitMin).toBe(7 * 60);   // le samedi (hors 35 h lun→ven) est gratuit
  });
  it("Ven+Sam AVEC saisie (Lun→Jeu = 28h) → 7h (déficit vs 35h)", () => {
    const weeks: CounterWeekInput[] = [
      { week: "2026-W28", days: [day(7), day(7), day(7), day(7), { tag: "recup" }, { tag: "recup" }, {}], option: null },
    ];
    expect(computeRecupCounter(weeks, [], PROFILE, ASOF).debitMin).toBe(7 * 60);
  });
  it("Samedi SEUL posé en récup → ne décompte RIEN (jour non travaillé)", () => {
    const c = computeRecupCounter([], ["2026-07-11"], PROFILE, ASOF); // samedi
    expect(c.debitMin).toBe(0);
  });
  it("un jour férié (lun→ven) posé en récup ne décompte rien non plus", () => {
    // Impossible via l'UI (le férié prime), mais la règle doit tenir : 14 juillet.
    const c = computeRecupCounter([], ["2026-07-14"], PROFILE, "2026-07-20");
    expect(c.debitMin).toBe(0);
  });
});

describe("planning — découpe récup/CP par jours entiers (splitLeaveRecupCp)", () => {
  // 2026-07-06 lun … 07 mar 08 mer 09 jeu 10 ven 11 sam (W28).
  it("semaine lun→sam, 2 jours de récup → 2 j récup (lun-mar) + 4 j CP (mer-sam)", () => {
    const s = splitLeaveRecupCp("2026-07-06", "2026-07-11", 2);
    expect(s.recup).toEqual({ start: "2026-07-06", end: "2026-07-07" });
    expect(s.cp).toEqual({ start: "2026-07-08", end: "2026-07-11" });
    expect(s.recupDays).toBe(2);
    expect(s.cpDays).toBe(4);   // mer, jeu, ven, sam
  });
  it("RÈGLE SAMEDI : récup jeu+ven (semaine complétée à 35 h) → samedi NON décompté, seul le lundi en CP", () => {
    // 16 jeu, 17 ven, 18 SAM, 19 dim, 20 lun (juillet 2026). Récup couvre jeu+ven
    // → la semaine est à 35 h : le samedi 18 est gratuit, le CP démarre lundi 20.
    const s = splitLeaveRecupCp("2026-07-16", "2026-07-20", 2);
    expect(s.recup).toEqual({ start: "2026-07-16", end: "2026-07-17" });
    expect(s.cp).toEqual({ start: "2026-07-20", end: "2026-07-20" }); // le samedi 18 n'est PAS dans le CP
    expect(s.recupDays).toBe(2);
    expect(s.cpDays).toBe(1);   // uniquement le lundi
  });
  it("RÈGLE SAMEDI : récup s'arrête au jeudi (semaine NON complétée) → le samedi reste décompté", () => {
    // Récup couvre seulement jeu 16 ; ven 17 + sam 18 partent en CP (semaine < 35 h).
    const s = splitLeaveRecupCp("2026-07-16", "2026-07-20", 1);
    expect(s.recup).toEqual({ start: "2026-07-16", end: "2026-07-16" });
    expect(s.cp).toEqual({ start: "2026-07-17", end: "2026-07-20" });
    expect(s.cpDays).toBe(3);   // ven + sam + lun (le samedi compte : semaine non bouclée par la récup)
  });
  it("récup couvre tout (≥ jours de contrat) → tout en récup, pas de CP", () => {
    const s = splitLeaveRecupCp("2026-07-06", "2026-07-10", 5); // lun→ven
    expect(s.recup).toEqual({ start: "2026-07-06", end: "2026-07-10" });
    expect(s.cp).toBeNull();
    expect(s.recupDays).toBe(5);
  });
  it("moins d'une journée entière de récup → tout en CP", () => {
    const s = splitLeaveRecupCp("2026-07-06", "2026-07-10", 0);
    expect(s.recup).toBeNull();
    expect(s.cp).toEqual({ start: "2026-07-06", end: "2026-07-10" });
    expect(s.cpDays).toBe(5);
  });
  it("un seul jour posé + récup dispo → ce jour en récup", () => {
    const s = splitLeaveRecupCp("2026-07-06", "2026-07-06", 3);
    expect(s.recup).toEqual({ start: "2026-07-06", end: "2026-07-06" });
    expect(s.cp).toBeNull();
    expect(s.recupDays).toBe(1);
  });
  it("un férié dans la plage ne compte pas comme jour de contrat récupérable", () => {
    // 2026-07-13 lun, 14 mar (férié), 15 mer, 16 jeu, 17 ven.
    const s = splitLeaveRecupCp("2026-07-13", "2026-07-17", 2);
    // 2 jours de contrat = lun 13 + mer 15 (le 14 férié est sauté).
    expect(s.recup).toEqual({ start: "2026-07-13", end: "2026-07-15" });
    expect(s.cp).toEqual({ start: "2026-07-16", end: "2026-07-17" });
    expect(s.recupDays).toBe(2);
  });
});
