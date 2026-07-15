import { describe, it, expect } from "vitest";
import { grossMarginPct } from "./margin";

describe("grossMarginPct — base unique marge brute %", () => {
  it("rapporte la marge au CA produit NET (pas au CA total)", () => {
    // 30 € de marge sur 100 € de CA produit net → 30 %.
    expect(grossMarginPct(30, 100)).toBe(30);
  });

  it("base ≤ 0 → 0 % (garde-fou, jamais NaN/Infinity)", () => {
    expect(grossMarginPct(50, 0)).toBe(0);
    expect(grossMarginPct(50, -10)).toBe(0);
  });

  it("marge négative → % négatif (vente à perte visible, pas masquée)", () => {
    expect(grossMarginPct(-20, 100)).toBe(-20);
  });

  it("cohérence : même (marge, base) → même % quel que soit l'écran", () => {
    const m = 1234.56, base = 9876.54;
    expect(grossMarginPct(m, base)).toBe(grossMarginPct(m, base));
    expect(grossMarginPct(m, base)).toBeCloseTo((m / base) * 100, 10);
  });

  it("inclure les services au dénominateur abaisse la marge % (démonstration du bug évité)", () => {
    const margin = 30;
    const caProduct = 100;   // base correcte (hors services)
    const caTotal = 130;     // base erronée (30 € de prestation sans coût)
    expect(grossMarginPct(margin, caProduct)).toBeGreaterThan(grossMarginPct(margin, caTotal));
  });

  it("coût hybride : repli sur le coût SAP (grossProfit) quand la réception est périmée/absente", () => {
    // Fraise vendue 540 € (72 kg × 7,50). Réception récente absente (dernière = 8
    // mois avant, prix d'hiver 11 €/kg) → on N'utilise PAS ce coût périmé. Repli
    // sur le coût SAP de la ligne : grossProfit = 180 € (coût réel 5 €/kg).
    const lineTotal = 540;
    const sapGrossProfit = 180;          // branche COGS_MARGIN_HYBRID « coût SAP »
    // Marge de la ligne = grossProfit (pas 540 − 72×11 = −252 € du coût périmé).
    expect(sapGrossProfit).toBeGreaterThan(0);
    expect(grossMarginPct(sapGrossProfit, lineTotal)).toBeCloseTo(33.3, 1);
    // Le coût périmé aurait donné une fausse perte :
    const staleMargin = lineTotal - 72 * 11;
    expect(staleMargin).toBeLessThan(0);
  });

  it("coût fabrication (articles reconditionnés) : marge = revenu × (1 − ratio coût), indépendant des unités", () => {
    // Un kit DECO n'a pas de réception d'achat directe : son coût vient de la
    // fabrication (composants + main d'œuvre). Ratio coût = totalCost/parentValue
    // du run. Le coût d'une ligne vendue = lineTotal × ratio (pur €, aucune
    // conversion colis/pièce/kg). Ex. run à 70 % de coût (30 % de marge) :
    const costRatio = 0.7;
    const lineTotal = 240;               // revenu d'une ligne vendue (€)
    const margin = lineTotal * (1 - costRatio); // = 72 € (branche COGS_MARGIN_FAB)
    expect(margin).toBeCloseTo(72, 10);
    // Rapportée à son propre CA, la marge de cette ligne = (1 − ratio) = 30 %,
    // quelle que soit l'unité de vente (le ratio est en euros).
    expect(grossMarginPct(margin, lineTotal)).toBeCloseTo(30, 10);
  });

  it("ventes à découvert : la base = CA des lignes COSTÉES (num. et dénom. sur le même jeu)", () => {
    // Journée type négoce frais : une ligne costée (EM reçue) + une vente à
    // découvert (coût EM pas encore saisi → exclue du numérateur `margin`).
    //   ligne costée   : lineTotal 100 €, coût 80 € → marge 20 €
    //   ligne découvert: lineTotal 300 €, coût inconnu → marge NULL (exclue)
    const marginCosted = 20;      // Σ marge sur lignes costées uniquement
    const caCosted = 100;         // Σ lineTotal sur lignes costées uniquement
    const caAllProduct = 400;     // 100 + 300 (inclut le découvert)

    // Base CORRECTE (costée) : marge réelle du costable = 20 %.
    expect(grossMarginPct(marginCosted, caCosted)).toBe(20);

    // Base BUGGÉE (tout le produit) : 20 / 400 = 5 % — la marge s'effondre alors
    // que rien n'a changé côté marge, juste parce que le CA à découvert reste au
    // dénominateur sans contribuer au numérateur. C'est le symptôme « 2,6 % ».
    expect(grossMarginPct(marginCosted, caAllProduct)).toBeCloseTo(5, 10);
    expect(grossMarginPct(marginCosted, caAllProduct))
      .toBeLessThan(grossMarginPct(marginCosted, caCosted));
  });
});
