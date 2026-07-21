import { describe, it, expect } from "vitest";
import { prevMonth, selectPayslipMonths } from "./commissionsCalc";
import type { CommissionMonth } from "./commissionsCalc";

const M = (month: string, prime: number): CommissionMonth => ({
  month, invoices: 1, creditNotes: 0, basePositive: prime * 20, avoirs: 0,
  base: prime * 20, prime,
});

// Arriéré : nov. 2025 → juil. 2026, une prime par mois.
const months = [
  M("2025-11", 100), M("2025-12", 120), M("2026-01", 90),
  M("2026-02", 110), M("2026-03", 130), M("2026-04", 105),
  M("2026-05", 115), M("2026-06", 125), M("2026-07", 140),
];
const sum = (ms: CommissionMonth[]) => ms.reduce((s, m) => s + m.prime, 0);

describe("prevMonth", () => {
  it("recule d'un mois, passage d'année inclus", () => {
    expect(prevMonth("2026-01")).toBe("2025-12");
    expect(prevMonth("2026-07")).toBe("2026-06");
  });
});

describe("selectPayslipMonths — commissions payées au fil des mois", () => {
  it("rien réglé (null) → la paie rattrape TOUT l'arriéré jusqu'au mois", () => {
    const got = selectPayslipMonths(months, "2026-07", null);
    expect(got.map((m) => m.month)).toEqual([
      "2025-11", "2025-12", "2026-01", "2026-02", "2026-03", "2026-04", "2026-05", "2026-06", "2026-07",
    ]);
    expect(sum(got)).toBe(1035);
  });

  it("réglé jusqu'au mois précédent → seul le mois courant est dû (mensuel)", () => {
    const got = selectPayslipMonths(months, "2026-07", "2026-06");
    expect(got.map((m) => m.month)).toEqual(["2026-07"]);
    expect(sum(got)).toBe(140);
  });

  it("réglé jusqu'au mois COURANT (envoi/rectif) → borné au mois précédent : le mois courant reste dû, jamais vidé", () => {
    const got = selectPayslipMonths(months, "2026-07", "2026-07");
    expect(got.map((m) => m.month)).toEqual(["2026-07"]);
    expect(sum(got)).toBe(140);
  });

  it("réglé partiellement (jusqu'à mars) → cumule avril→juillet", () => {
    const got = selectPayslipMonths(months, "2026-07", "2026-03");
    expect(got.map((m) => m.month)).toEqual(["2026-04", "2026-05", "2026-06", "2026-07"]);
    expect(sum(got)).toBe(485);
  });

  it("ne compte jamais un mois FUTUR (au-delà du mois de paie)", () => {
    const got = selectPayslipMonths(months, "2026-02", null);
    expect(got.map((m) => m.month)).toEqual(["2025-11", "2025-12", "2026-01", "2026-02"]);
  });
});
