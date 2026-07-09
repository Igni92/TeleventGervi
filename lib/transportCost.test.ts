import { describe, it, expect } from "vitest";
import {
  annualizeLine,
  computeTransportMetrics,
  transportPerKgForCarrier,
  transportCostForSale,
  netTransportMargin,
  isDirectCarrier,
  sanitizeTransportModel,
  sanitizeClientPricing,
  sanitizeExpensePhotos,
  MAX_EXPENSE_PHOTOS,
  EMPTY_TRANSPORT_MODEL,
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
    ...EMPTY_TRANSPORT_MODEL,
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

describe("règle TRANSPORTEUR : direct = prix position, autres = tarif client × transporteur", () => {
  const model: TransportCostModel = { ...EMPTY_TRANSPORT_MODEL, directCarriers: ["DIRECT"] };
  // Tarifs propres à UN client, par transporteur non direct.
  const clientPricing = { SCACHAP: 0.05 };

  it("transporteur direct → prix position (tarif client ignoré)", () => {
    expect(isDirectCarrier(model, "direct")).toBe(true); // insensible à la casse
    expect(transportPerKgForCarrier(model, 0.1, "DIRECT", clientPricing)).toBe(0.1);
    expect(transportCostForSale(model, 0.1, 500, "DIRECT", clientPricing)).toBeCloseTo(50, 6);
  });

  it("transporteur non direct → tarif SAISI POUR CE CLIENT", () => {
    expect(isDirectCarrier(model, "SCACHAP")).toBe(false);
    expect(transportPerKgForCarrier(model, 0.1, "SCACHAP", clientPricing)).toBe(0.05);
    expect(transportCostForSale(model, 0.1, 500, "SCACHAP", clientPricing)).toBeCloseTo(25, 6);
  });

  it("transporteur non direct SANS tarif client → 0", () => {
    expect(transportPerKgForCarrier(model, 0.1, "ANTOINE", clientPricing)).toBe(0);
    expect(transportPerKgForCarrier(model, 0.1, "SCACHAP", null)).toBe(0); // pas de tarif fourni
    expect(transportCostForSale(model, 0.1, 500, "ANTOINE", clientPricing)).toBe(0);
  });

  it("aucun transporteur direct paramétré → repli « tout direct »", () => {
    const unclassified = { ...EMPTY_TRANSPORT_MODEL };
    expect(transportPerKgForCarrier(unclassified, 0.1, "ANTOINE")).toBe(0.1);
    expect(transportPerKgForCarrier(unclassified, 0.1, null)).toBe(0.1);
  });

  it("marge nette transport = marge brute − coût de transport (transporteur + tarif client)", () => {
    expect(netTransportMargin(model, 100, 200, "DIRECT", 0.1, clientPricing)).toBeCloseTo(80, 6);   // 100 − 20
    expect(netTransportMargin(model, 100, 200, "SCACHAP", 0.1, clientPricing)).toBeCloseTo(90, 6);  // 100 − 10
    expect(netTransportMargin(model, 100, 200, "ANTOINE", 0.1, clientPricing)).toBe(100);           // 100 − 0
  });
});

describe("sanitizeClientPricing — tarifs client par transporteur", () => {
  it("clés MAJUSCULES, valeurs ≥ 0, entrées vides/négatives écartées", () => {
    expect(sanitizeClientPricing({ scachap: 0.05, antoine: -1, "": 0.2, delanchy: 0 })).toEqual({ SCACHAP: 0.05 });
    expect(sanitizeClientPricing(null)).toEqual({});
    expect(sanitizeClientPricing("nope")).toEqual({});
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

  it("transporteurs directs en MAJUSCULES et dédoublonnés", () => {
    const m = sanitizeTransportModel({ directCarriers: [" direct ", "DIRECT", "antoine"] });
    expect(m.directCarriers).toEqual(["DIRECT", "ANTOINE"]);
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
