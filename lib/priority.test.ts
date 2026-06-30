import { describe, it, expect } from "vitest";
import { computePriority } from "./priority";

describe("computePriority", () => {
  it("classe un nouveau client (jamais commandé) sans planter", () => {
    const r = computePriority({ lastOrderDays: null, medianIntervalDays: null });
    expect(r.lifecycle.state).toBe("NOUVEAU");
    expect(r.tier.tier).toBe("D");
    expect(r.overdueRatio).toBeNull();
    expect(r.reason).toMatch(/nouveau/i);
    expect(Number.isFinite(r.score)).toBe(true);
  });

  it("un client dans sa cadence est ACTIF et peu prioritaire", () => {
    const r = computePriority({ lastOrderDays: 3, medianIntervalDays: 5 });
    expect(r.lifecycle.state).toBe("ACTIF");
    expect(r.overdueRatio).toBeLessThan(1);
  });

  it("le retard est RELATIF à la cadence (un quotidien à +5 j est plus urgent qu'un mensuel à +5 j)", () => {
    const quotidien = computePriority({ lastOrderDays: 5, medianIntervalDays: 2 }); // 2.5× cadence
    const mensuel = computePriority({ lastOrderDays: 5, medianIntervalDays: 30 }); // 0.17× cadence
    expect(quotidien.score).toBeGreaterThan(mensuel.score);
    expect(quotidien.lifecycle.state).not.toBe("ACTIF");
    expect(mensuel.lifecycle.state).toBe("ACTIF");
  });

  it("à urgence égale, le gros compte (palier A) passe devant le petit (palier D)", () => {
    const base = { lastOrderDays: 12, medianIntervalDays: 5 } as const;
    const gros = computePriority({ ...base, ca12m: 80_000 }); // A
    const petit = computePriority({ ...base, ca12m: 500 }); // D
    expect(gros.tier.tier).toBe("A");
    expect(petit.tier.tier).toBe("D");
    expect(gros.score).toBeGreaterThan(petit.score);
  });

  it("l'urgence reste le moteur principal : un petit À RISQUE passe devant un gros ACTIF", () => {
    const petitARisque = computePriority({ lastOrderDays: 14, medianIntervalDays: 5, ca12m: 500 });
    const grosActif = computePriority({ lastOrderDays: 3, medianIntervalDays: 5, ca12m: 80_000 });
    expect(petitARisque.lifecycle.state).toBe("A_RISQUE");
    expect(grosActif.lifecycle.state).toBe("ACTIF");
    expect(petitARisque.score).toBeGreaterThan(grosActif.score);
  });

  it("le ratio de retard est borné (saturation au-delà du plafond)", () => {
    const r = computePriority({ lastOrderDays: 1000, medianIntervalDays: 1 });
    expect(r.overdueRatio).toBe(4); // OVERDUE_RATIO_CAP
  });

  it("les incidents ouverts augmentent (légèrement) la priorité", () => {
    const sans = computePriority({ lastOrderDays: 6, medianIntervalDays: 5, openIncidents: 0 });
    const avec = computePriority({ lastOrderDays: 6, medianIntervalDays: 5, openIncidents: 2 });
    expect(avec.score).toBeGreaterThan(sans.score);
  });

  it("Perdu (> 90 j absolu) reste moins prioritaire qu'un client À risque encore récupérable", () => {
    const perdu = computePriority({ lastOrderDays: 120, medianIntervalDays: 30, ca12m: 80_000 });
    const aRisque = computePriority({ lastOrderDays: 14, medianIntervalDays: 5, ca12m: 80_000 });
    expect(perdu.lifecycle.state).toBe("PERDU");
    expect(aRisque.lifecycle.state).toBe("A_RISQUE");
    expect(aRisque.score).toBeGreaterThan(perdu.score);
  });

  it("génère une phrase d'action lisible avec les jours de retard", () => {
    const r = computePriority({ lastOrderDays: 9, medianIntervalDays: 3 });
    expect(r.reason).toMatch(/9 j/);
  });

  it("est robuste aux valeurs aberrantes (NaN/Infinity)", () => {
    const r = computePriority({
      lastOrderDays: Number.NaN,
      medianIntervalDays: Number.POSITIVE_INFINITY,
      ca12m: Number.NaN,
    });
    expect(Number.isFinite(r.score)).toBe(true);
    expect(r.tier.tier).toBe("D");
  });
});
