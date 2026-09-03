import { describe, it, expect } from "vitest";
import { computeAnnual, fractionPresence, fractionEcoulee } from "./annualisation";

describe("RH V2 — annualisation IDCC 1405 (1600h)", () => {
  it("temps plein présent toute l'année, à mi-parcours pile dans la moyenne", () => {
    const r = computeAnnual({ heuresRealisees: 800, fractionEcoulee: 0.5 });
    expect(r.heuresTheoAnnee).toBe(1600);
    expect(r.heuresTheoADate).toBe(800);
    expect(r.soldeModulH).toBe(0);          // pile dans la modulation
    expect(r.heuresSuppAnnee).toBe(0);      // pas encore de supp
  });

  it("haute saison : avance sur le dû-à-date", () => {
    const r = computeAnnual({ heuresRealisees: 1000, fractionEcoulee: 0.5 });
    expect(r.soldeModulH).toBe(200);        // 1000 − 800 = +200 (avance)
    expect(r.heuresSuppAnnee).toBe(0);      // pas encore au-delà de 1600
  });

  it("basse saison : retard sur le dû-à-date", () => {
    const r = computeAnnual({ heuresRealisees: 600, fractionEcoulee: 0.5 });
    expect(r.soldeModulH).toBe(-200);
  });

  it("fin de période, dépassement des 1600h → heures supp année, net des payées", () => {
    const r = computeAnnual({ heuresRealisees: 1750, fractionEcoulee: 1, heuresSuppDejaPayees: 50 });
    expect(r.heuresSuppAnnee).toBe(100);    // 1750 − 1600 − 50 = 100
    expect(r.contingent).toBe(200);
    expect(r.contingentRestant).toBe(100);
    expect(r.depasseContingent).toBe(false);
  });

  it("dépassement du contingent 200h signalé", () => {
    const r = computeAnnual({ heuresRealisees: 1900, fractionEcoulee: 1 });
    expect(r.heuresSuppAnnee).toBe(300);
    expect(r.depasseContingent).toBe(true);
    expect(r.contingentRestant).toBe(-100);
  });

  it("prorata présence : entrée à mi-période → dû divisé par 2", () => {
    const r = computeAnnual({ heuresRealisees: 400, fractionPresence: 0.5, fractionEcoulee: 1 });
    expect(r.heuresTheoAnnee).toBe(800);    // 1600 × 0.5
    expect(r.heuresSuppAnnee).toBe(0);      // 400 < 800
  });

  it("fractionPresence & fractionEcoulee (bornes)", () => {
    const p0 = new Date("2025-06-01"); const p1 = new Date("2026-06-01");
    expect(fractionPresence(p0, p1, null, null)).toBe(1);
    expect(fractionPresence(p0, p1, new Date("2025-12-01"), null)).toBeCloseTo(0.5, 1);
    expect(fractionEcoulee(p0, p1, new Date("2025-12-01"))).toBeCloseTo(0.5, 1);
    expect(fractionEcoulee(p0, p1, new Date("2024-01-01"))).toBe(0); // avant début
  });
});
