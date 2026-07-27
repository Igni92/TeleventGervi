import { describe, it, expect } from "vitest";
import { buildSuppRecap } from "./heuresRecap";
import type { DayHours, HeuresOption, HoursProfile } from "./heuresCalc";

const PROFILE: HoursProfile = { weeklyHours: 35, typicalDay: { m1: "06:00", m2: "13:00" } };
const day = (h: number): DayHours => ({ m1: "06:00", m2: `${String(6 + h).padStart(2, "0")}:00` });
const w5 = (h: number): DayHours[] => [day(h), day(h), day(h), day(h), day(h), {}, {}];

type E = { days: (DayHours | undefined)[]; option: HeuresOption | null; paySuppMin?: number | null };
const M = (rows: [string, E][]) => new Map<string, E>(rows);

describe("heuresRecap — buildSuppRecap", () => {
  it("ventile chaque semaine selon son option ; option nulle = RÉCUP par défaut", () => {
    const recap = buildSuppRecap(M([
      ["2026-W27", { days: w5(8), option: "recup" }],       // 40h → 5h supp → 6h15 maj récup
      ["2026-W28", { days: w5(9), option: null }],          // 45h → 13h maj → RÉCUP (non payé)
      ["2026-W29", { days: w5(8), option: "paiement" }],    // 40h → 6h15 maj payé
    ]), PROFILE);
    expect(recap.map((r) => r.weekNum)).toEqual([27, 28, 29]);
    const [a, b, c] = recap;
    expect(a.majMin).toBe(375); expect(a.recupMajMin).toBe(375); expect(a.payMajMin).toBe(0);
    // Option nulle → tout en récup (plus de « en attente »).
    expect(b.recupMajMin).toBe(780); expect(b.payMajMin).toBe(0);
    expect(c.payMajMin).toBe(375); expect(c.recupMajMin).toBe(0);
    // Jamais d'heure perdue : payé + récup = total majoré (par semaine).
    for (const r of recap) expect(r.payMajMin + r.recupMajMin).toBe(r.majMin);
  });
});
