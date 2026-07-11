import { describe, it, expect } from "vitest";
import {
  expandDates, expandOuvrables, expandSemaine, monthGridDays, isoWeekOfDate,
  computeRecupCounter, recupCapExcessMin, cpPeriodOf, computeCpCounter,
  computeMonthRecap, monthEndISO, dayAfter, congeCreditsHours,
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
  it("les tags absent / maladie / récup ne créditent rien", () => {
    const days: DayHours[] = [{ tag: "absent" }, { tag: "maladie" }, { tag: "recup" }, {}, {}, {}, {}];
    const c = computeWeek(days, 35, 7 * 60);
    expect(c.totalMin).toBe(0);
  });
});

describe("planning — compteur récup (décompte au passage de la semaine)", () => {
  // 2026-W27 = 29 juin → 5 juillet ; 2026-W28 = 6 → 12 juillet.
  const ASOF = "2026-07-11"; // W27 terminée, W28 en cours

  it("crédit : semaine passée à 39 h en option récup → +4 h", () => {
    const weeks: CounterWeekInput[] = [
      { week: "2026-W27", days: [day(8), day(8), day(8), day(8), day(7)], option: "recup" },
    ];
    const c = computeRecupCounter(weeks, [], PROFILE, ASOF);
    expect(c.creditMin).toBe(4 * 60);
    expect(c.debitMin).toBe(0);
    expect(c.balanceMin).toBe(4 * 60);
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
    expect(c.creditMin).toBe(4 * 60);
    expect(c.debitMin).toBe(7 * 60);   // W27 passée sans saisie → journée réputée prise
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
      { week: "2026-W27", days: [day(9), day(9), day(9), day(9), day(9)], option: "recup" }, // +10 h
    ];
    const recap = computeMonthRecap(weeks, [], [], { ...PROFILE, recupCapHours: 7, cpAllowanceDays: 25 }, "2026-07");
    expect(recap.recupBalanceMin).toBe(10 * 60);
    expect(recap.recupCapMin).toBe(7 * 60);
    expect(recap.excessMin).toBe(3 * 60);    // 3 h à payer sur le bulletin du mois suivant
    expect(recap.cpBalanceDays).toBe(25);
  });
  it("congeCreditsHours : seuls les CP créditent des heures", () => {
    expect(congeCreditsHours("cp")).toBe(true);
    expect(congeCreditsHours("recup")).toBe(false);
    expect(congeCreditsHours("maladie")).toBe(false);
  });
});
