import { describe, it, expect } from "vitest";
import {
  splitByWarehouse, totalAvailable, computeItfel, computeDdg,
  categoryFromGroupName, resolveCoef, computeSuggestedPrice, personalStock, unitInfo,
  chooseLot, LOT_PENDING,
  LOT_FAMILY_PREFIX, familyLotSentinel, familyOfLot, isLotPending, isRealLot,
} from "./gervifrais-calc";

describe("isRealLot — vrais lots EM (réception) ET OP (fabrication)", () => {
  it("accepte un lot de réception EM<DocNum>", () => {
    expect(isRealLot("EM14878")).toBe(true);
  });
  it("accepte un lot d'ordre de production OP<NNNNN> (produit fabriqué)", () => {
    expect(isRealLot("OP00001")).toBe(true);
    expect(isRealLot("OP12345")).toBe(true);
  });
  it("rejette les sentinels d'attente et le bruit", () => {
    expect(isRealLot("EM_PENDING")).toBe(false);
    expect(isRealLot("EM_FAM:fraise")).toBe(false);
    expect(isRealLot("")).toBe(false);
    expect(isRealLot(null)).toBe(false);
    expect(isRealLot("OP")).toBe(false);   // pas de numéro
    expect(isRealLot("LOT42")).toBe(false);
  });
});

describe("splitByWarehouse — découpe multi-entrepôt", () => {
  it("6 framboises (5 en 000, 2 en 01) → 5×000 + 1×01", () => {
    expect(splitByWarehouse(6, { "000": 5, "01": 2, R1: 0 })).toEqual([
      { warehouse: "000", qty: 5 }, { warehouse: "01", qty: 1 },
    ]);
  });
  it("respecte l'ordre 000→01→R1", () => {
    expect(splitByWarehouse(10, { "000": 3, "01": 3, R1: 10 })).toEqual([
      { warehouse: "000", qty: 3 }, { warehouse: "01", qty: 3 }, { warehouse: "R1", qty: 4 },
    ]);
  });
  it("sur-vente → surplus sur ligne SÉPARÉE à découvert (jamais fusionné)", () => {
    expect(splitByWarehouse(10, { "000": 4, "01": 0, R1: 0 })).toEqual([
      { warehouse: "000", qty: 4 },
      { warehouse: "000", qty: 6, decouvert: true },
    ]);
  });
  it("sur-vente avec stock en 01 → le stock reste en 01, le surplus part en 000 à découvert", () => {
    // Régression « magasins négatifs » : le surplus ne doit plus gonfler la
    // ligne 01 (01 passait à −5), il attend en 000 sans lot.
    expect(splitByWarehouse(10, { "000": 0, "01": 5, R1: 0 })).toEqual([
      { warehouse: "01", qty: 5 },
      { warehouse: "000", qty: 5, decouvert: true },
    ]);
  });
  it("aucun stock → tout à découvert sur 000", () => {
    expect(splitByWarehouse(5, { "000": 0, "01": 0, R1: 0 })).toEqual([
      { warehouse: "000", qty: 5, decouvert: true },
    ]);
  });
  it("ignore les dispos négatives (committed > stock)", () => {
    expect(totalAvailable({ "000": 48, "01": -129, R1: 0 })).toBe(48);
  });
});

describe("TPF — taxes para-fiscales (calibré sur BL #24011199)", () => {
  it("INTERFEL = LineHT × 0,21 %", () => {
    expect(computeItfel(232)).toBe(0.49);     // FE1SL
    expect(computeItfel(27.6)).toBe(0.06);    // FRAMB12PD
    expect(computeItfel(109.2)).toBe(0.23);   // K100
  });
  it("INTERFEL nul sur ligne sans HT", () => {
    expect(computeItfel(0)).toBe(0);
  });
  it("DDG = nb_colis × 0,02 €", () => {
    expect(computeDdg(40)).toBe(0.8);   // FE1SL 40 kg = 40 colis
    expect(computeDdg(1)).toBe(0.02);   // 1 colis
  });
});

describe("Prix conseillé (calibré sur vue GERVI : échalotte achat 0,90)", () => {
  it("catégorie déduite du nom de groupe", () => {
    expect(categoryFromGroupName("Fraises")).toBe("Fraises");
    expect(categoryFromGroupName("Légumes")).toBe("Legumes");
    expect(categoryFromGroupName("Déco fruits rouges")).toBe("Fruits_Rges");
    expect(categoryFromGroupName("Agrumes")).toBe("Divers_Fruits");
    expect(categoryFromGroupName("Emballage")).toBeNull();
  });
  it("RUNGIS légumes : 0,90 × 0,4 = 0,36", () => {
    const { coef, isDefault } = resolveCoef("Legumes", { base: { Legumes: 0.4 } }, 0.9);
    expect(coef).toBe(0.4); expect(isDefault).toBe(false);
    expect(computeSuggestedPrice(0.9, coef)).toBe(0.36);
  });
  it("groupe sans coef → défaut 1,5 : 0,90 × 1,5 = 1,35", () => {
    const { coef, isDefault } = resolveCoef("Legumes", { base: {} }, 0.9);
    expect(coef).toBe(1.5); expect(isDefault).toBe(true);
    expect(computeSuggestedPrice(0.9, coef)).toBe(1.35);
  });
  it("AUCHAN légumes : 0,90 × 0,8 = 0,72", () => {
    expect(computeSuggestedPrice(0.9, resolveCoef("Legumes", { base: { Legumes: 0.8 } }, 0.9).coef)).toBe(0.72);
  });
  it("fraises : palier de prix d'achat appliqué", () => {
    const coefs = { base: { Fraises: 0.9 }, fraiseBands: { b0_3: 1.2, b3_5: 1.1, b5_8: 1.0, b8_999: 0.9 } };
    expect(resolveCoef("Fraises", coefs, 2).coef).toBe(1.2);   // <3
    expect(resolveCoef("Fraises", coefs, 4).coef).toBe(1.1);   // 3-5
    expect(resolveCoef("Fraises", coefs, 10).coef).toBe(0.9);  // ≥8
  });
});

describe("unitInfo — fraise au kg, le reste au colis", () => {
  it("fraise (kg) → au kilo, pas de division, prix /kg", () => {
    expect(unitInfo("KG", 5)).toEqual({ packDivisor: 1, displayUnit: "kg", priceUnit: "kg", isKg: true });
  });
  it("colis de 12 pièces → unité colis, packDivisor 12, prix /pie", () => {
    expect(unitInfo("pie", 12)).toEqual({ packDivisor: 12, displayUnit: "colis", priceUnit: "pie", isKg: false });
  });
  it("sans emballage (1/colis) → unité = unité de vente", () => {
    expect(unitInfo("pie", 1)).toEqual({ packDivisor: 1, displayUnit: "pie", priceUnit: "pie", isKg: false });
  });
});

describe("unitInfo — conditionnement NumInSale × SalPackUn (relevé scripts/diag-condi.mjs)", () => {
  // FB4KA3 réel : SalesUnit "KG", NumInSale 1, SalPackUn 4, poids 1 kg/unité,
  // condi "8x500g" → colis de 4 kg. Panier en COLIS, SAP en KG (colis × 4),
  // prix affiché AU KILO. Vérifié sur BL réels (Quantity=28 KG / 7 colis).
  it("fraise 8×500g (FB4KA3 : KG, SalPackUn 4) → vendu par colis de 4 kg, prix /kg", () => {
    expect(unitInfo("KG", 4, 1, 1)).toEqual({
      packDivisor: 4, displayUnit: "colis", priceUnit: "kg", isKg: true, colisWeightKg: 4,
    });
  });
  it("fraise 4×1kg (NumInSale 4 × SalPackUn 1) → même colis de 4 kg", () => {
    expect(unitInfo("KG", 1, 4, 1)).toEqual({
      packDivisor: 4, displayUnit: "colis", priceUnit: "kg", isKg: true, colisWeightKg: 4,
    });
  });
  it("fraise 10×500g (FA5 : SalPackUn 5) → colis de 5 kg", () => {
    expect(unitInfo("KG", 5, 1, 1)).toEqual({
      packDivisor: 5, displayUnit: "colis", priceUnit: "kg", isKg: true, colisWeightKg: 5,
    });
  });
  it("fraise vrac 1 kg (FE1SL : SalPackUn 1) → reste au kilo", () => {
    expect(unitInfo("KG", 1, 1, 1)).toEqual({
      packDivisor: 1, displayUnit: "kg", priceUnit: "kg", isKg: true, colisWeightKg: 1,
    });
  });
  it("framboise 12×125g (FRAMB12PD : pie ×12, 0,125 kg) → colis de 1,5 kg, prix /pie", () => {
    expect(unitInfo("pie", 12, 1, 0.125)).toEqual({
      packDivisor: 12, displayUnit: "colis", priceUnit: "pie", isKg: false, colisWeightKg: 1.5,
    });
  });
  it("poids/unité inconnu sur un article pièce → colisWeightKg null", () => {
    expect(unitInfo("pie", 12, 1, null)).toEqual({
      packDivisor: 12, displayUnit: "colis", priceUnit: "pie", isKg: false, colisWeightKg: null,
    });
  });
  it("NULL-SAFE : salesItemsPerUnit absent → comportement historique STRICT (pas de colisWeightKg)", () => {
    // Mêmes objets que le régime historique — la clé colisWeightKg ne doit pas exister.
    expect(unitInfo("KG", 4)).toEqual({ packDivisor: 1, displayUnit: "kg", priceUnit: "kg", isKg: true });
    expect(unitInfo("KG", 4, null)).toEqual({ packDivisor: 1, displayUnit: "kg", priceUnit: "kg", isKg: true });
    expect(unitInfo("pie", 12, undefined)).toEqual({ packDivisor: 12, displayUnit: "colis", priceUnit: "pie", isKg: false });
  });
});

describe("chooseLot — affectation SYSTÉMATIQUE du lot (bug BL 24011560)", () => {
  it("lot FIFO résolu + stock local → on pose le lot", () => {
    expect(chooseLot({ resolvedLot: "EM22948", localAvailable: 480 }))
      .toEqual({ lot: "EM22948", reason: "fifo" });
  });
  it("miroir local en retard (0) mais stock SAP présent → lot quand même (cas fraise du matin)", () => {
    expect(chooseLot({ resolvedLot: "EM22948", localAvailable: 0, sapOnHand: 480 }))
      .toEqual({ lot: "EM22948", reason: "fifo" });
  });
  it("lot résolu mais aucun stock nulle part → vente à découvert → EM_PENDING", () => {
    expect(chooseLot({ resolvedLot: "EM22762", localAvailable: 0, sapOnHand: 0 }))
      .toEqual({ lot: LOT_PENDING, reason: "decouvert" });
  });
  it("dispo locale négative (committed > stock) + SAP vide → EM_PENDING", () => {
    expect(chooseLot({ resolvedLot: "EM22762", localAvailable: -12, sapOnHand: null }))
      .toEqual({ lot: LOT_PENDING, reason: "decouvert" });
  });
  it("aucun lot résolvable malgré du stock (article hors fenêtre PDN) → EM_PENDING, plus jamais EM0000", () => {
    expect(chooseLot({ resolvedLot: null, localAvailable: 50 }))
      .toEqual({ lot: LOT_PENDING, reason: "aucun-pdn" });
  });
  it("aucun lot + aucun stock → EM_PENDING (découvert)", () => {
    expect(chooseLot({ resolvedLot: null, localAvailable: 0 }))
      .toEqual({ lot: LOT_PENDING, reason: "decouvert" });
  });
  it("défaut env opt-in (GERVIFRAIS_LOT_DEFAUT) respecté quand pas de lot mais du stock", () => {
    expect(chooseLot({ resolvedLot: null, localAvailable: 10, envDefault: "EM9999" }))
      .toEqual({ lot: "EM9999", reason: "env-defaut" });
  });
  it("le lot n'est JAMAIS vide", () => {
    expect(chooseLot({ resolvedLot: null, localAvailable: 0, envDefault: "  " }).lot).toBe(LOT_PENDING);
  });
});

describe("Sentinel famille — « affecter un produit (fraise) » sur un bon de commande", () => {
  it("familyLotSentinel construit EM_FAM:<clé> normalisée", () => {
    expect(familyLotSentinel("fraise")).toBe(`${LOT_FAMILY_PREFIX}fraise`);
    expect(familyLotSentinel("  Framboise ")).toBe(`${LOT_FAMILY_PREFIX}framboise`);
  });
  it("familyOfLot extrait la clé d'un sentinel famille, null sinon", () => {
    expect(familyOfLot("EM_FAM:fraise")).toBe("fraise");
    expect(familyOfLot(" EM_FAM:MYRTILLE ")).toBe("myrtille");
    expect(familyOfLot("EM22948")).toBeNull();
    expect(familyOfLot(LOT_PENDING)).toBeNull();
    expect(familyOfLot("")).toBeNull();
    expect(familyOfLot(null)).toBeNull();
    expect(familyOfLot("EM_FAM:")).toBeNull();   // préfixe sans clé = pas un tag valide
  });
  it("isLotPending : vide, EM_PENDING et sentinel famille sont EN ATTENTE ; un vrai EM ne l'est pas", () => {
    expect(isLotPending("")).toBe(true);
    expect(isLotPending(null)).toBe(true);
    expect(isLotPending(LOT_PENDING)).toBe(true);
    expect(isLotPending("EM_FAM:fraise")).toBe(true);
    expect(isLotPending("EM22948")).toBe(false);
  });
  it("un sentinel famille N'EST PAS le sentinel à découvert (goods-receipts ne l'auto-résout pas)", () => {
    // Garantie « rappel manuel » : la propagation rétro filtre sur `=== LOT_PENDING`.
    expect(familyLotSentinel("fraise")).not.toBe(LOT_PENDING);
  });
});

describe("Stock perso commercial", () => {
  it("30% de 100 dispo = 30", () => expect(personalStock(100, 30)).toBe(30));
  it("100% = tout le stock", () => expect(personalStock(84, 100)).toBe(84));
  it("dispo négatif → 0", () => expect(personalStock(-5, 50)).toBe(0));
});
