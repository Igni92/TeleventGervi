import { describe, it, expect } from "vitest";
import { monthlySlicesDesc } from "./sync-slices";

const d = (s: string) => new Date(s);

describe("monthlySlicesDesc", () => {
  it("découpe un an en tranches mensuelles, plus récente d'abord", () => {
    const slices = monthlySlicesDesc(d("2025-06-25T00:00:00Z"), d("2026-06-25T12:00:00Z"));
    // 13 mois touchés (juin 2025 → juin 2026 inclus).
    expect(slices.length).toBe(13);
    // 1ʳᵉ tranche = mois courant, bornée au `to` exact.
    expect(slices[0].to.toISOString().slice(0, 10)).toBe("2026-06-25");
    expect(slices[0].from.toISOString().slice(0, 10)).toBe("2026-06-01");
    // Ordre décroissant strict.
    for (let i = 1; i < slices.length; i++) {
      expect(slices[i].to.getTime()).toBeLessThan(slices[i - 1].from.getTime());
    }
  });

  it("clamp la dernière tranche sur `from`", () => {
    const from = d("2026-03-10T00:00:00Z");
    const slices = monthlySlicesDesc(from, d("2026-05-20T00:00:00Z"));
    const last = slices[slices.length - 1];
    expect(last.from.toISOString()).toBe(from.toISOString());
    expect(last.to.toISOString().slice(0, 10)).toBe("2026-03-31");
  });

  it("couvre toute la plage sans trou (chaînage des bornes)", () => {
    const slices = monthlySlicesDesc(d("2026-01-01T00:00:00Z"), d("2026-04-15T00:00:00Z"));
    // Du plus ancien au plus récent : chaque `from` suivant = lendemain (ou même
    // mois) — on vérifie qu'il n'y a pas de mois manquant entre deux tranches.
    const asc = [...slices].reverse();
    for (let i = 1; i < asc.length; i++) {
      const prevEnd = asc[i - 1].to;
      const curStart = asc[i].from;
      // La tranche suivante démarre le 1er du mois juste après la fin précédente.
      expect(curStart.getTime()).toBeGreaterThan(prevEnd.getTime());
      const gapDays = (curStart.getTime() - prevEnd.getTime()) / 86_400_000;
      expect(gapDays).toBeLessThanOrEqual(1); // bornes jointives (le/ge inclusifs)
    }
  });

  it("un seul mois → une seule tranche [from, to]", () => {
    const from = d("2026-06-05T00:00:00Z");
    const to = d("2026-06-25T00:00:00Z");
    const slices = monthlySlicesDesc(from, to);
    expect(slices).toHaveLength(1);
    expect(slices[0].from.toISOString()).toBe(from.toISOString());
    expect(slices[0].to.toISOString()).toBe(to.toISOString());
  });

  it("plage vide si to < from", () => {
    expect(monthlySlicesDesc(d("2026-06-25"), d("2026-06-24"))).toEqual([]);
  });
});
