import { describe, it, expect } from "vitest";
import { docTransportCost, type DocTransportContext } from "./transportDoc";
import type { CarrierTariff } from "./carrierTariff";

/** Grille externe de test : zone 59/62, forfait 0-100 puis aux 100 kg. */
const antoine: CarrierTariff = {
  carrierCode: "ANTOINE",
  brackets: [
    { id: "b1", minKg: 0, maxKg: 100, unit: "position" },
    { id: "b2", minKg: 101, maxKg: 800, unit: "per100kg" },
  ],
  zones: [{ id: "z1", label: "Nord", departements: ["59", "62"], prices: { b1: 46.51, b2: 38.94 } }],
  extras: [],
  updatedAt: null,
  updatedBy: null,
};

/** Grille DELANCHY de test : zone IDF, forfait 0-100 puis aux 100 kg. Fargier
 *  (réseau Delanchy) doit se tarifer dessus, y compris en IDF. */
const delanchy: CarrierTariff = {
  carrierCode: "DELANCHY",
  brackets: [
    { id: "d1", minKg: 0, maxKg: 100, unit: "position" },
    { id: "d2", minKg: 101, maxKg: 1000, unit: "per100kg" },
  ],
  zones: [{ id: "z1", label: "IDF", departements: ["75", "77", "78", "91", "92", "93", "94", "95"], prices: { d1: 32, d2: 25 } }],
  extras: [],
  updatedAt: null,
  updatedBy: null,
};

const ctx: DocTransportContext = {
  model: {
    costs: [], deliveriesPerYear: 1427, kgPerYear: 84434,
    directCarriers: ["DIRECT"], updatedAt: null, updatedBy: null,
  },
  costPerDelivery: 25.25,
  prixPositionPerKg: 0.427,
  tariffs: { ANTOINE: antoine, DELANCHY: delanchy },
  tournees: new Map([["LWAT", { trspCode: "ANTOINE", heure: null, nom: null, des: null, lineId: null }]]),
  pricingById: new Map(),
};

describe("docTransportCost", () => {
  it("magasin IDF (GMS/CHR) = DIRECT au coût position — SAUF réseau Delanchy (grille Delanchy)", () => {
    // Delanchy (FT94) en IDF → tarifé sur la GRILLE DELANCHY, PAS au coût flotte.
    // 40 kg → forfait 0-100 = 32 €.
    const t = docTransportCost(ctx, { cardCode: "LORLY", zip: "94 310", kg: 40, trspCode: "FT94", segment: "GMS" });
    expect(t.mode).toBe("grille");
    expect(t.cost).toBeCloseTo(32);
    // FARGIER n'est PLUS du réseau Delanchy (2026-09) → transporteur indépendant :
    // la règle IDF « direct » s'applique comme pour tout autre transporteur.
    const tf = docTransportCost(ctx, { cardCode: "LORLY", zip: "94 310", kg: 40, trspCode: "FARGIER", segment: "GMS" });
    expect(tf.mode).toBe("direct");
    // …et SANS transporteur identifié, la règle IDF « direct » s'applique aussi.
    const t2 = docTransportCost(ctx, { cardCode: "XIDF", zip: "77100", kg: 40, segment: "CHR" });
    expect(t2.mode).toBe("direct");
    expect(t2.cost).toBeCloseTo(25.25);
  });

  it("la règle IDF ne s'applique PAS aux segments non livrés (Rungis/export) ni hors IDF", () => {
    // Rungis (94) segment RUNGIS → pas de livraison, pas de coût.
    const r = docTransportCost(ctx, { cardCode: "XRUN", zip: "94150", kg: 40, segment: "RUNGIS" });
    expect(r.cost).toBe(0);
    // Wattrelos (59) GMS → hors IDF : grille ANTOINE via la tournée (forfait 0-100).
    const w = docTransportCost(ctx, { cardCode: "LWAT", zip: "59 150", kg: 80, segment: "GMS" });
    expect(w.mode).toBe("grille");
    expect(w.cost).toBeCloseTo(46.51);
  });

  it("direct = coût PAR POSITION (pas €/kg) ; transporteur inconnu = 0 signalé ; kg ≤ 0 = 0", () => {
    const d = docTransportCost(ctx, { cardCode: "XDIR", zip: "45000", kg: 500, trspCode: "DIRECT", segment: "GMS" });
    expect(d.mode).toBe("direct");
    expect(d.cost).toBeCloseTo(25.25); // pas 0,427 × 500
    const u = docTransportCost(ctx, { cardCode: "XUNK", zip: "33000", kg: 100, trspCode: "DSV", segment: "GMS" });
    expect(u.mode).toBe("aucun");
    expect(u.cost).toBe(0);
    expect(u.carrier).toBe("DSV"); // connu mais sans tarif → signalé, pas muet
    expect(docTransportCost(ctx, { cardCode: "XSVC", zip: "75001", kg: 0, segment: "GMS" }).cost).toBe(0);
  });

  it("le transporteur RÉEL du document prime sur la tournée habituelle", () => {
    // LWAT a une tournée ANTOINE, mais le doc dit DIRECT → direct.
    const t = docTransportCost(ctx, { cardCode: "LWAT", zip: "59 150", kg: 80, trspCode: "DIRECT", segment: "GMS" });
    expect(t.mode).toBe("direct");
    expect(t.fromDoc).toBe(true);
  });
});
