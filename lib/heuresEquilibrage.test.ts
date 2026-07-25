import { describe, it, expect } from "vitest";
import { planEquilibrage, planHasChanges, type EqWeekInput } from "./heuresEquilibrage";
import type { DayHours, HoursProfile } from "./heuresCalc";
import type { CongeRequest } from "./conges";

const PROFILE: HoursProfile = { weeklyHours: 35, typicalDay: { m1: "06:00", m2: "13:00" } }; // journée type 7 h

/** Journée d'`h` heures (une seule plage à partir de 06:00). */
const day = (h: number): DayHours => ({ m1: "06:00", m2: `${String(6 + h).padStart(2, "0")}:00` });
/** Semaine : 5 jours ouvrés d'`h` heures + samedi/dimanche vides. */
const week5 = (h: number): DayHours[] => [day(h), day(h), day(h), day(h), day(h), {}, {}];

const cp = (id: string, start: string, end: string, status: CongeRequest["status"] = "approved"): CongeRequest => ({
  id, email: "x@y.z", name: "X", type: "cp", start, end, note: "", status, origin: "salarie", createdAt: "2026-01-01T00:00:00Z",
});

const base = (entries: EqWeekInput[], conges: CongeRequest[], todayISO = "2026-08-03") =>
  planEquilibrage({ email: "x@y.z", name: "X", profile: PROFILE, entries, conges, todayISO });

describe("équilibrage — étape 1 : supp indécises → récup", () => {
  it("passe une semaine supp `option:null` en récup, sans toucher les décidées", () => {
    const p = base(
      [
        { week: "2026-W28", days: week5(10), option: null },   // 50 h → 15 h supp
        { week: "2026-W29", days: week5(10), option: "paiement" }, // déjà décidée → intacte
        { week: "2026-W30", days: week5(7), option: null },    // 35 h → pas de supp
      ],
      [],
    );
    expect(p.weekOptionChanges.map((w) => w.week)).toEqual(["2026-W28"]);
    expect(p.weekOptionChanges[0].suppMin).toBe(15 * 60);
    // 8 h à +25 % + 7 h à +50 % = 10 h + 10h30 = 20h30 majorées
    expect(p.weekOptionChanges[0].majEquivMin).toBe(Math.round(8 * 60 * 1.25 + 7 * 60 * 1.5));
  });

  it("garde-fou : le total d'heures supp ne change jamais (avant == après)", () => {
    const p = base([{ week: "2026-W28", days: week5(10), option: null }], []);
    expect(p.totalArbitrableMinAfter).toBe(p.totalArbitrableMinBefore);
    expect(p.totalArbitrableMinBefore).toBe(15 * 60);
  });
});

describe("équilibrage — étape 2 : la récup remplace les CP à venir", () => {
  it("convertit des jours de CP entiers dans la limite du solde récup", () => {
    // W28 : 50 h → 15 h supp → 20h30 majorées créditées = 1230 min → budget = 2 jours (2×420=840 ≤ 1230)
    const p = base(
      [{ week: "2026-W28", days: week5(10), option: null }],
      [cp("c1", "2026-08-10", "2026-08-14")], // lun→ven = 5 jours de contrat
    );
    expect(p.recupBudgetDays).toBe(2);
    expect(p.conversions).toHaveLength(1);
    const c = p.conversions[0];
    expect(c.congeId).toBe("c1");
    expect(c.recupContractDays).toBe(2);
    expect(c.recupDebitMin).toBe(2 * 420);
    expect(c.recupStart).toBe("2026-08-10");
    expect(c.cpStart).toBe("2026-08-12"); // le reste part en CP
    expect(p.cpGivenBackDays).toBe(2);
  });

  it("ne convertit rien sans solde récup suffisant pour une journée pleine", () => {
    // W28 : 40 h → 5 h supp → 6h15 majorées = 375 min < 420 → budget 0 jour
    const p = base(
      [{ week: "2026-W28", days: week5(8), option: null }],
      [cp("c1", "2026-08-10", "2026-08-14")],
    );
    expect(p.recupBudgetDays).toBe(0);
    expect(p.conversions).toHaveLength(0);
    expect(planHasChanges(p)).toBe(true); // l'étape 1 a quand même agi
  });

  it("ignore les CP déjà passés (jamais rétroactif)", () => {
    const p = base(
      [{ week: "2026-W28", days: week5(10), option: null }],
      [cp("old", "2026-07-06", "2026-07-10")], // avant today
    );
    expect(p.conversions).toHaveLength(0);
  });

  it("la récup déjà posée à venir réduit le budget disponible", () => {
    // Même crédit (budget brut 2 j) mais un jour de récup déjà posé la semaine
    // prochaine → il ne reste qu'1 jour convertible.
    const p = base(
      [
        { week: "2026-W28", days: week5(10), option: null },
        // W32 (10-17 août) : lundi taggé récup, déjà posé, à venir → réservé.
        { week: "2026-W32", days: [{ tag: "recup" }, {}, {}, {}, {}, {}, {}], option: "recup" },
      ],
      [cp("c1", "2026-08-24", "2026-08-28")],
    );
    expect(p.recupBudgetDays).toBe(1);
    expect(p.conversions[0]?.recupContractDays).toBe(1);
  });

  it("rien à faire → planHasChanges = false", () => {
    const p = base([{ week: "2026-W30", days: week5(7), option: null }], []);
    expect(planHasChanges(p)).toBe(false);
  });
});
