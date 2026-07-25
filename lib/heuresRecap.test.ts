import { describe, it, expect } from "vitest";
import { buildSuppRecap } from "./heuresRecap";
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
