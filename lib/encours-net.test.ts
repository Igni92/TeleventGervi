import { describe, it, expect } from "vitest";
import { netEncours } from "./encours-net";

describe("netEncours — encours net du compte (encaissé/avoirs déduits en ligne)", () => {
  it("sans solde compte → net = brut, rien à déduire", () => {
    const r = netEncours(6020, null);
    expect(r.net).toBe(6020);
    expect(r.encaisse).toBe(0);
  });

  it("cas FANTASY : 170 413,91 brut, solde compte 84 988,43 → net + encaissé", () => {
    const r = netEncours(170413.91, 84988.43);
    expect(r.net).toBeCloseTo(84988.43, 2);
    expect(r.encaisse).toBeCloseTo(85425.48, 2);
  });

  it("solde compte ≥ brut (autres débits) → net = brut, rien déduit", () => {
    const r = netEncours(1000, 5000);
    expect(r.net).toBe(1000);
    expect(r.encaisse).toBe(0);
  });

  it("solde compte ≤ 0 (client à jour / créditeur) → net 0, tout déduit", () => {
    const r = netEncours(5000, 0);
    expect(r.net).toBe(0);
    expect(r.encaisse).toBe(5000);
  });
});
