import { describe, it, expect } from "vitest";
import { colisInfo } from "./colis";

/**
 * Conditionnement colis — nb colis EXACT (diviseur unitsPerColis) + poids d'un
 * colis. Cas calibrés sur les relevés SAP réels (sap_export/Items.csv).
 * Module PUR (sans Prisma) → ce test reste 100 % hors-ligne.
 */
describe("colisInfo — nb colis exact + poids colis", () => {
  it("article au KG avec SalPackUn (AIL : KG, 20/colis, wt 1) → 20 kg/colis", () => {
    const c = colisInfo({ salesUnit: "KG", salesQtyPerPackUnit: 20, salesUnitWeight: 1 });
    expect(c).toEqual({ unitsPerColis: 20, colisWeightKg: 20, unitLabel: "colis" });
  });

  it("article au KG sans SalPackUn → poids du sac (BANANE : KG, SalPackUn 1, wt 3.5) → 3.5 kg/colis", () => {
    const c = colisInfo({ salesUnit: "KG", salesQtyPerPackUnit: 1, salesUnitWeight: 3.5 });
    expect(c).toEqual({ unitsPerColis: 3.5, colisWeightKg: 3.5, unitLabel: "colis" });
  });

  it("article au KG sans SalPackUn ni poids → 1 kg/colis (défaut sûr)", () => {
    const c = colisInfo({ salesUnit: "KG", salesQtyPerPackUnit: null, salesUnitWeight: null });
    expect(c).toEqual({ unitsPerColis: 1, colisWeightKg: 1, unitLabel: "colis" });
  });

  it("le piège FRAMB12PD/MD (pie, 12/colis, wt 0.125) → 12 barq./colis, colis = 1.5 kg", () => {
    const c = colisInfo({ salesUnit: "pie", salesQtyPerPackUnit: 12, salesUnitWeight: 0.125 });
    // nbColis = qté_pie / 12 ; poids d'un colis = 12 × 0.125 = 1.5 kg
    expect(c).toEqual({ unitsPerColis: 12, colisWeightKg: 1.5, unitLabel: "colis" });
  });

  it("article au COLIS (AVOCAT : Colis, SalPackUn 15, wt 0.3) → colis de 4.5 kg, diviseur 15", () => {
    // Le front envoie colis×15 à SAP (régime historique unitInfo) → on redivise par 15.
    const c = colisInfo({ salesUnit: "Colis", salesQtyPerPackUnit: 15, salesUnitWeight: 0.3 });
    expect(c).toEqual({ unitsPerColis: 15, colisWeightKg: 4.5, unitLabel: "colis" });
  });

  it("article au colis non regroupé (SalPackUn ≤ 1) → 1/colis, l'article EST le colis", () => {
    const c = colisInfo({ salesUnit: "Colis", salesQtyPerPackUnit: 1, salesUnitWeight: 0.3 });
    expect(c).toEqual({ unitsPerColis: 1, colisWeightKg: 0.3, unitLabel: "colis" });
  });

  it("NumInSale ignoré pour le comptage : ENDIVE (KG, SalPackUn 5) → 5 kg/colis (pas 25)", () => {
    // Le « nouveau régime » de unitInfo multiplierait par NumInSale=5 → 25 kg/colis (faux,
    // condi SAP = "5kg"). colisInfo s'appuie sur le seul SalPackUn.
    const c = colisInfo({ salesUnit: "KG", salesQtyPerPackUnit: 5, salesUnitWeight: 1 });
    expect(c.unitsPerColis).toBe(5);
    expect(c.colisWeightKg).toBe(5);
  });

  it("barquette unité réelle (non regroupée) → libellé « barquette »", () => {
    const c = colisInfo({ salesUnit: "BARQ", salesQtyPerPackUnit: 1, salesUnitWeight: 0.25 });
    expect(c.unitsPerColis).toBe(1);
    expect(c.unitLabel).toBe("barquette");
  });

  it("barquettes regroupées en colis (SalPackUn > 1) → libellé « colis »", () => {
    const c = colisInfo({ salesUnit: "barq", salesQtyPerPackUnit: 8, salesUnitWeight: 0.125 });
    expect(c.unitsPerColis).toBe(8);
    expect(c.unitLabel).toBe("colis");
    expect(c.colisWeightKg).toBe(1); // 8 × 0.125
  });

  it("article pièce sans poids → colisWeightKg null (poids inconnu)", () => {
    const c = colisInfo({ salesUnit: "pie", salesQtyPerPackUnit: 12, salesUnitWeight: null });
    expect(c).toEqual({ unitsPerColis: 12, colisWeightKg: null, unitLabel: "colis" });
  });

  it("fabrication : fraise au KG en colis de 4 kg (FB4KA2D : KG, SalPackUn 4, wt 1) → 4 kg/colis", () => {
    // Régression OP00001/OP00002 : packRatio (lib/fabrication) délègue ici —
    // « 5 colis » de FB4KA2D doivent sortir 20 kg dans SAP, pas 5 kg
    // (BL réels : Quantity=28 KG / PackageQuantity=7 pour 7 colis).
    const c = colisInfo({ salesUnit: "KG", salesQtyPerPackUnit: 4, salesUnitWeight: 1 });
    expect(c.unitsPerColis).toBe(4);
    expect(c.colisWeightKg).toBe(4);
    expect(5 * c.unitsPerColis).toBe(20); // 5 colis → Quantity SAP = 20 kg
  });
});
