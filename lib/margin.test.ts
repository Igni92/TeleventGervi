import { describe, it, expect } from "vitest";
import { grossMarginPct } from "./margin";

describe("grossMarginPct — base unique marge brute %", () => {
  it("rapporte la marge au CA produit NET (pas au CA total)", () => {
    // 30 € de marge sur 100 € de CA produit net → 30 %.
    expect(grossMarginPct(30, 100)).toBe(30);
  });

  it("base ≤ 0 → 0 % (garde-fou, jamais NaN/Infinity)", () => {
    expect(grossMarginPct(50, 0)).toBe(0);
    expect(grossMarginPct(50, -10)).toBe(0);
  });

  it("marge négative → % négatif (vente à perte visible, pas masquée)", () => {
    expect(grossMarginPct(-20, 100)).toBe(-20);
  });

  it("cohérence : même (marge, base) → même % quel que soit l'écran", () => {
    const m = 1234.56, base = 9876.54;
    expect(grossMarginPct(m, base)).toBe(grossMarginPct(m, base));
    expect(grossMarginPct(m, base)).toBeCloseTo((m / base) * 100, 10);
  });

  it("inclure les services au dénominateur abaisse la marge % (démonstration du bug évité)", () => {
    const margin = 30;
    const caProduct = 100;   // base correcte (hors services)
    const caTotal = 130;     // base erronée (30 € de prestation sans coût)
    expect(grossMarginPct(margin, caProduct)).toBeGreaterThan(grossMarginPct(margin, caTotal));
  });
});
