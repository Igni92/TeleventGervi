import { describe, it, expect } from "vitest";
import { buildSuppRecap, planFifoPayout } from "./heuresRecap";
import type { DayHours, HeuresOption, HoursProfile } from "./heuresCalc";

const PROFILE: HoursProfile = { weeklyHours: 35, typicalDay: { m1: "06:00", m2: "13:00" } };
const day = (h: number): DayHours => ({ m1: "06:00", m2: `${String(6 + h).padStart(2, "0")}:00` });
const w5 = (h: number): DayHours[] => [day(h), day(h), day(h), day(h), day(h), {}, {}];

type E = { days: (DayHours | undefined)[]; option: HeuresOption | null; paySuppMin?: number | null };
const M = (rows: [string, E][]) => new Map<string, E>(rows);

describe("heuresRecap — buildSuppRecap", () => {
  it("ventile chaque semaine selon son option ; conservation majoré", () => {
    const recap = buildSuppRecap(M([
      ["2026-W27", { days: w5(8), option: "recup" }],       // 40h → 5h supp → 6h15 maj
      ["2026-W28", { days: w5(9), option: null }],          // 45h → 10h supp → 13h maj (en attente)
      ["2026-W29", { days: w5(8), option: "paiement" }],    // 40h → 6h15 maj payé
    ]), PROFILE);
    expect(recap.map((r) => r.weekNum)).toEqual([27, 28, 29]);
    const [a, b, c] = recap;
    expect(a.majMin).toBe(375); expect(a.recupMajMin).toBe(375); expect(a.payMajMin).toBe(0); expect(a.pendingMajMin).toBe(0);
    expect(b.pendingMajMin).toBe(780); expect(b.payMajMin).toBe(0); expect(b.recupMajMin).toBe(0);
    expect(c.payMajMin).toBe(375); expect(c.recupMajMin).toBe(0);
    // Jamais d'heure perdue : payé + récup + attente = total majoré (par semaine).
    for (const r of recap) expect(r.payMajMin + r.recupMajMin + r.pendingMajMin).toBe(r.majMin);
  });
});

describe("heuresRecap — planFifoPayout", () => {
  const entries = M([
    ["2026-W27", { days: w5(8), option: "recup" }],   // maj 6h15 (375)
    ["2026-W28", { days: w5(9), option: "recup" }],   // maj 13h00 (780)
    ["2026-W29", { days: w5(8), option: "recup" }],   // maj 6h15 (375)
  ]);

  it("paie les semaines les plus anciennes d'abord (clôture) + charnière en mixte", () => {
    const plan = planFifoPayout(entries, PROFILE, 375 + 200); // 6h15 + 3h20 majoré
    expect(plan.closedWeeks).toEqual(["2026-W27"]);           // W27 clôturée
    expect(plan.changes.find((c) => c.week === "2026-W27")!.option).toBe("paiement");
    const w28 = plan.changes.find((c) => c.week === "2026-W28")!;
    expect(w28.option).toBe("mixte");
    expect(w28.paySuppMin).toBe(160);                         // 200 maj ÷ 1,25 = 160 brut
    expect(plan.changes.find((c) => c.week === "2026-W29")!.option).toBe("recup");
    expect(plan.paidMajMin).toBe(575);                        // exactement le budget
    expect(plan.leftoverMajMin).toBe(0);
  });

  it("budget 0 → tout en récup", () => {
    const plan = planFifoPayout(entries, PROFILE, 0);
    expect(plan.changes.every((c) => c.option === "recup")).toBe(true);
    expect(plan.paidMajMin).toBe(0);
  });

  it("budget supérieur au total → tout payé, surplus rendu en leftover", () => {
    const plan = planFifoPayout(entries, PROFILE, 100 * 60);
    expect(plan.changes.every((c) => c.option === "paiement")).toBe(true);
    expect(plan.closedWeeks).toHaveLength(3);
    expect(plan.paidMajMin).toBe(375 + 780 + 375);
    expect(plan.leftoverMajMin).toBe(100 * 60 - (375 + 780 + 375));
  });
});
