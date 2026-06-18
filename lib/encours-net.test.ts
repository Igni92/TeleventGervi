import { describe, it, expect } from "vitest";
import { netEncours } from "./encours-net";

describe("netEncours — encours net du compte (encaissé déduit)", () => {
  it("sans solde compte → net = brut, tranches inchangées", () => {
    const r = netEncours({ openTotal: 6020, b3045: 0, b4590: 1200, b90: 0, currentAccountBalance: null });
    expect(r.net).toBe(6020);
    expect(r.encaisse).toBe(0);
    expect(r.b4590).toBe(1200);
  });

  it("cas FANTASY : 170 413,91 brut, solde compte 84 988,43 → net + encaissé déduit", () => {
    const r = netEncours({
      openTotal: 170413.91,
      b3045: 0,
      b4590: 78100, // tranche 45-90 j (la plus ancienne ici)
      b90: 0,
      currentAccountBalance: 84988.43,
    });
    expect(r.net).toBeCloseTo(84988.43, 2);
    expect(r.encaisse).toBeCloseTo(85425.48, 2);
    // L'encaissé (85 425) couvre toute la tranche 45-90 (78 100) → 0, le reliquat
    // réduit la part non échue.
    expect(r.b4590).toBe(0);
  });

  it("alloue l'encaissé aux tranches les plus anciennes d'abord (FIFO)", () => {
    // brut 100 : >90=20, 45-90=30, 30-45=10, non échu=40. Encaissé 35.
    const r = netEncours({ openTotal: 100, b3045: 10, b4590: 30, b90: 20, currentAccountBalance: 65 });
    expect(r.net).toBe(65);
    expect(r.encaisse).toBe(35);
    expect(r.b90).toBe(0); // 20 absorbé
    expect(r.b4590).toBe(15); // 30 − 15 restant
    expect(r.b3045).toBe(10); // intact
  });

  it("solde compte ≥ brut (autres débits) → net = brut, rien déduit", () => {
    const r = netEncours({ openTotal: 1000, b3045: 0, b4590: 0, b90: 1000, currentAccountBalance: 5000 });
    expect(r.net).toBe(1000);
    expect(r.encaisse).toBe(0);
    expect(r.b90).toBe(1000);
  });

  it("solde compte ≤ 0 (client à jour / créditeur) → net 0, tranches à 0", () => {
    const r = netEncours({ openTotal: 5000, b3045: 1000, b4590: 2000, b90: 1000, currentAccountBalance: 0 });
    expect(r.net).toBe(0);
    expect(r.encaisse).toBe(5000);
    expect(r.b3045).toBe(0);
    expect(r.b4590).toBe(0);
    expect(r.b90).toBe(0);
  });
});
