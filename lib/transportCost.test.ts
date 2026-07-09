import { describe, it, expect } from "vitest";
import {
  annualizeLine,
  computeTransportMetrics,
  transportPerKgForType,
  transportCostForSale,
  netTransportMargin,
  typeSupportsTransport,
  sanitizeTransportModel,
  sanitizeExpensePhotos,
  MAX_EXPENSE_PHOTOS,
  type TransportCostModel,
} from "./transportCost";

describe("annualizeLine — annualisation d'une ligne de coût", () => {
  it("hebdo × 52, mensuel × 12, annuel tel quel", () => {
    expect(annualizeLine({ kind: "entretien", amount: 100, period: "weekly", amortYears: null })).toBe(5200);
    expect(annualizeLine({ kind: "salaire", amount: 2000, period: "monthly", amortYears: null })).toBe(24000);
    expect(annualizeLine({ kind: "autre", amount: 800, period: "annual", amortYears: null })).toBe(800);
  });

  it("amortissement : investissement total ÷ nb années (périodicité ignorée)", () => {
    // Camion 30 000 € amorti sur 5 ans → 6 000 €/an, même si period=monthly.
    expect(annualizeLine({ kind: "amortissement", amount: 30000, period: "monthly", amortYears: 5 })).toBe(6000);
  });

  it("montant ≤ 0 → 0 (garde-fou)", () => {
    expect(annualizeLine({ kind: "casse", amount: 0, period: "annual", amortYears: null })).toBe(0);
    expect(annualizeLine({ kind: "casse", amount: -50, period: "weekly", amortYears: null })).toBe(0);
  });
});

describe("computeTransportMetrics — prix position €/kg", () => {
  const model: TransportCostModel = {
    costs: [
      { id: "1", label: "Camion", kind: "amortissement", amount: 30000, period: "annual", amortYears: 5 }, // 6000/an
      { id: "2", label: "Salaire", kind: "salaire", amount: 2000, period: "monthly", amortYears: null },   // 24000/an
      { id: "3", label: "Entretien", kind: "entretien", amount: 0, period: "annual", amortYears: null },   // 0
    ],
    deliveriesPerYear: 3000,
    kgPerYear: 300000,
  };

  it("annuel = somme des lignes annualisées ; hebdo/mensuel indicatifs", () => {
    const m = computeTransportMetrics(model);
    expect(m.annualCost).toBe(30000); // 6000 + 24000
    expect(m.monthlyCost).toBeCloseTo(2500, 6);
    expect(m.weeklyCost).toBeCloseTo(30000 / 52, 6);
  });

  it("coût/livraison = annuel ÷ nb livraisons ; prix position = annuel ÷ kg", () => {
    const m = computeTransportMetrics(model);
    expect(m.costPerDelivery).toBeCloseTo(10, 6);      // 30000 / 3000
    expect(m.prixPositionPerKg).toBeCloseTo(0.1, 6);   // 30000 / 300000
  });

  it("répartition par famille", () => {
    const m = computeTransportMetrics(model);
    expect(m.byKind.amortissement).toBe(6000);
    expect(m.byKind.salaire).toBe(24000);
    expect(m.byKind.entretien).toBe(0);
  });

  it("kg ou livraisons = 0 → pas de division par zéro", () => {
    const m = computeTransportMetrics({ ...model, kgPerYear: 0, deliveriesPerYear: 0 });
    expect(m.prixPositionPerKg).toBe(0);
    expect(m.costPerDelivery).toBe(0);
  });

  it("modèle nul/vide → tout à zéro", () => {
    const m = computeTransportMetrics(null);
    expect(m.annualCost).toBe(0);
    expect(m.prixPositionPerKg).toBe(0);
  });
});

describe("règle IDF : EXPORT = 0, CHR / GMS = prix position", () => {
  it("EXPORT ne supporte pas le transport (payé par le client)", () => {
    expect(typeSupportsTransport("EXPORT")).toBe(false);
    expect(transportPerKgForType(0.1, "EXPORT")).toBe(0);
    expect(transportCostForSale(0.1, 500, "EXPORT")).toBe(0);
  });

  it("CHR est calculé comme les autres IDF", () => {
    expect(transportPerKgForType(0.1, "CHR")).toBe(0.1);
    expect(transportCostForSale(0.1, 500, "CHR")).toBeCloseTo(50, 6);
  });

  it("GMS et segment inconnu (IDF livré en propre) → prix position appliqué", () => {
    expect(transportPerKgForType(0.1, "GMS")).toBe(0.1);
    expect(transportPerKgForType(0.1, null)).toBe(0.1);
  });

  it("marge nette transport = marge brute − prix position × kg (0 pour export)", () => {
    expect(netTransportMargin(100, 200, "CHR", 0.1)).toBeCloseTo(80, 6); // 100 − 20
    expect(netTransportMargin(100, 200, "EXPORT", 0.1)).toBe(100);       // export : rien déduit
  });
});

describe("sanitizeTransportModel — normalisation défensive", () => {
  it("borne les montants négatifs à 0 et coerce les familles inconnues", () => {
    const m = sanitizeTransportModel({
      costs: [{ id: "x", label: "  Test  ", kind: "inconnu", amount: -5, period: "trimestriel" }],
      deliveriesPerYear: -10,
      kgPerYear: 12.345,
    });
    expect(m.costs[0].kind).toBe("autre");
    expect(m.costs[0].period).toBe("annual");
    expect(m.costs[0].amount).toBe(0);
    expect(m.costs[0].label).toBe("Test");
    expect(m.deliveriesPerYear).toBe(0);
    expect(m.kgPerYear).toBe(12.35);
  });

  it("amortYears conservé seulement pour un amortissement", () => {
    const m = sanitizeTransportModel({
      costs: [
        { kind: "amortissement", amount: 1000, amortYears: 4 },
        { kind: "entretien", amount: 1000, amortYears: 4 },
      ],
    });
    expect(m.costs[0].amortYears).toBe(4);
    expect(m.costs[1].amortYears).toBeNull();
  });
});

describe("sanitizeExpensePhotos — plafonds", () => {
  const okPhoto = "data:image/jpeg;base64," + "A".repeat(400);
  it("rejette les non-images et plafonne le nombre", () => {
    const many = Array.from({ length: MAX_EXPENSE_PHOTOS + 3 }, () => ({ dataUrl: okPhoto }));
    expect(sanitizeExpensePhotos(many).length).toBe(MAX_EXPENSE_PHOTOS);
    expect(sanitizeExpensePhotos([{ dataUrl: "not-an-image" }]).length).toBe(0);
    expect(sanitizeExpensePhotos("nope").length).toBe(0);
  });
});
