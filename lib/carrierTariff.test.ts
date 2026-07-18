import { describe, it, expect } from "vitest";
import {
  bracketForWeight,
  computePositionCost,
  normDept,
  sanitizeCarrierTariff,
  tariffIsUsable,
  tariffTemplateFor,
  zoneForDepartement,
  type CarrierTariff,
} from "./carrierTariff";

/** Grille de test : 2 tranches (forfait / aux 100 kg), 1 zone, 1 fixe + 1 %. */
const tariff: CarrierTariff = {
  carrierCode: "TEST",
  brackets: [
    { id: "b1", minKg: 0, maxKg: 50, unit: "position" },
    { id: "b2", minKg: 51, maxKg: 100, unit: "position" },
    { id: "b3", minKg: 101, maxKg: 300, unit: "per100kg" },
  ],
  zones: [
    { id: "z1", label: "IDF", departements: ["75", "92", "94"], prices: { b1: 37.86, b2: 40.2, b3: 34.02 } },
    { id: "z2", label: "Nord", departements: ["59", "62", "02"], prices: { b1: 43.26, b2: 46.51 } },
  ],
  extras: [
    { id: "adm", label: "Frais administratifs", kind: "fixed", value: 4.62 },
    { id: "gaz", label: "Majoration gazole", kind: "percent", value: 5 },
  ],
};

describe("normDept", () => {
  it("normalise les codes département", () => {
    expect(normDept("2")).toBe("02");
    expect(normDept("75")).toBe("75");
    expect(normDept("2a")).toBe("2A");
    expect(normDept("971")).toBe("971");
    expect(normDept("")).toBe("");
  });
});

describe("bracketForWeight", () => {
  it("choisit la tranche par borne haute, sans trous", () => {
    expect(bracketForWeight(tariff.brackets, 10)?.id).toBe("b1");
    expect(bracketForWeight(tariff.brackets, 50)?.id).toBe("b1");
    expect(bracketForWeight(tariff.brackets, 50.5)?.id).toBe("b2"); // pas de trou 50–51
    expect(bracketForWeight(tariff.brackets, 100)?.id).toBe("b2");
    expect(bracketForWeight(tariff.brackets, 250)?.id).toBe("b3");
  });
  it("hors grille : poids nul ou au-delà de la dernière borne", () => {
    expect(bracketForWeight(tariff.brackets, 0)).toBeNull();
    expect(bracketForWeight(tariff.brackets, 301)).toBeNull();
  });
  it("maxKg null = et au-delà", () => {
    const b = [{ id: "x", minKg: 0, maxKg: null, unit: "position" as const }];
    expect(bracketForWeight(b, 9999)?.id).toBe("x");
  });
});

describe("zoneForDepartement", () => {
  it("retrouve la zone du département (normalisé)", () => {
    expect(zoneForDepartement(tariff.zones, "75")?.id).toBe("z1");
    expect(zoneForDepartement(tariff.zones, "2")?.id).toBe("z2");   // "2" → "02"
    expect(zoneForDepartement(tariff.zones, "33")).toBeNull();
  });
});

describe("computePositionCost", () => {
  it("forfait position + % puis fixes : total = base × (1 + %÷100) + fixes", () => {
    const c = computePositionCost(tariff, "75", 40)!;
    expect(c.base).toBe(37.86);
    expect(c.percentAmount).toBeCloseTo(1.89, 2);   // 5 % de 37,86
    expect(c.fixedAmount).toBe(4.62);
    expect(c.total).toBeCloseTo(44.37, 2);
    expect(c.bracket.id).toBe("b1");
    expect(c.zone.id).toBe("z1");
  });
  it("tranche aux 100 kg : base = prix × kg ÷ 100", () => {
    const c = computePositionCost(tariff, "92", 200)!;
    expect(c.base).toBeCloseTo(68.04, 2);           // 34,02 × 200 ÷ 100
    expect(c.total).toBeCloseTo(68.04 * 1.05 + 4.62, 2);
  });
  it("null si département hors zones, poids hors tranches ou tranche non cotée", () => {
    expect(computePositionCost(tariff, "33", 40)).toBeNull();     // dépt non couvert
    expect(computePositionCost(tariff, "75", 0)).toBeNull();      // pas de poids
    expect(computePositionCost(tariff, "75", 500)).toBeNull();    // > dernière borne
    expect(computePositionCost(tariff, "59", 200)).toBeNull();    // b3 non coté en z2
    expect(computePositionCost(null, "75", 40)).toBeNull();
  });
});

describe("sanitizeCarrierTariff", () => {
  it("normalise codes, bornes et prix (positifs, 2 décimales)", () => {
    const t = sanitizeCarrierTariff({
      carrierCode: " delanchy ",
      brackets: [{ id: "b1", minKg: "0", maxKg: "50.129", unit: "position" }, { maxKg: null, unit: "nimp" }],
      zones: [{ id: "z1", label: "  IDF  ", departements: ["75", "75", "2", "zz"], prices: { b1: "37.856", inconnu: 9 } }],
      extras: [{ label: "Gazole", kind: "percent", value: "5.129" }, { label: "Fixe", kind: "autre", value: -3 }],
    });
    expect(t.carrierCode).toBe("DELANCHY");
    expect(t.brackets[0]).toMatchObject({ minKg: 0, maxKg: 50.13, unit: "position" });
    expect(t.brackets[1]).toMatchObject({ maxKg: null, unit: "position" });
    expect(t.zones[0].label).toBe("IDF");
    expect(t.zones[0].departements).toEqual(["75", "02", "ZZ"]);
    expect(t.zones[0].prices).toEqual({ b1: 37.86 });              // clé inconnue écartée
    expect(t.extras[0]).toMatchObject({ kind: "percent", value: 5.13 });
    expect(t.extras[1]).toMatchObject({ kind: "fixed", value: 0 }); // type inconnu → fixe, ≥ 0
    expect(sanitizeCarrierTariff(null).carrierCode).toBe("");
  });
});

describe("templates fournisseurs", () => {
  it("DELANCHY / FT<n° dépt> (tous les FT) → grille Delanchy 2025 (par département, 2 tranches)", () => {
    for (const code of ["DELANCHY", "FT86", "FT94", "DELANCHY FT86"]) {
      const t = tariffTemplateFor(code)!;
      expect(t).not.toBeNull();
      expect(t.brackets).toHaveLength(2);
      expect(tariffIsUsable(t)).toBe(true);
      // Dépt 44, 0–100 kg : 47,95 € / position + 5 % gazole + 4,62 € admin.
      const c = computePositionCost(t, "44", 80)!;
      expect(c.base).toBeCloseTo(47.95, 2);
      expect(c.total).toBeCloseTo(47.95 * 1.05 + 4.62, 2);
    }
  });
  it("ANTOINE → grille distribution 01/2026 (forfaits puis prix aux 100 kg)", () => {
    const t = tariffTemplateFor("ANTOINE")!;
    expect(t).not.toBeNull();
    // 75, 40 kg → forfait 37,86 € ; 75, 200 kg → 34,02 € aux 100 kg.
    expect(computePositionCost(t, "75", 40)!.base).toBeCloseTo(37.86, 2);
    expect(computePositionCost(t, "75", 200)!.base).toBeCloseTo(68.04, 2);
    // Pieds de facture GO + GNR + frais documentaire + palettes présents.
    expect(t.extras.map((x) => x.kind).sort()).toEqual(["fixed", "fixed", "percent", "percent"]);
  });
  it("code inconnu → pas de template (et pas de faux positif FT)", () => {
    expect(tariffTemplateFor("SCACHAP")).toBeNull();
    expect(tariffTemplateFor("SOFT86")).toBeNull();   // « FT86 » précédé d'une lettre ≠ dépôt FT
  });
});
