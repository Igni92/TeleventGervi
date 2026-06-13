import { describe, it, expect } from "vitest";
import {
  uniteGestion, quantitePhysique, libelleUnite, scenariosTransformation,
} from "./fabrication-optim";

describe("uniteGestion — unité de gestion réelle d'un article", () => {
  it("article au poids (fraise FB4KA3 : KG, 4×1 kg) → kg, 4 kg/colis", () => {
    const u = uniteGestion({ salesUnit: "KG", salesUnitWeight: 1, salesQtyPerPackUnit: 4, salesItemsPerUnit: 1 });
    expect(u).toEqual({ uniteColis: "colis", unitePhysique: "kg", physParColis: 4, auPoids: true });
  });
  it("au poids avec NumInSale (8×500g : weight 0.5, pack 8, items 2) → 8 kg/colis", () => {
    const u = uniteGestion({ salesUnit: "kg", salesUnitWeight: 0.5, salesQtyPerPackUnit: 8, salesItemsPerUnit: 2 });
    expect(u.physParColis).toBe(8);
    expect(u.unitePhysique).toBe("kg");
  });
  it("au poids sans salesUnitWeight (défaut 1 kg/pie) → pack = poids colis", () => {
    const u = uniteGestion({ salesUnit: "Kilo", salesUnitWeight: null, salesQtyPerPackUnit: 5, salesItemsPerUnit: null });
    expect(u.physParColis).toBe(5);
    expect(u.auPoids).toBe(true);
  });
  it("article en pièces regroupées (FRAMB12PD : pie ×12) → colis, 1/colis (jamais « pièce »)", () => {
    const u = uniteGestion({ salesUnit: "pie", salesUnitWeight: 0.125, salesQtyPerPackUnit: 12, salesItemsPerUnit: null });
    expect(u).toEqual({ uniteColis: "colis", unitePhysique: "colis", physParColis: 1, auPoids: false });
  });
  it("article géré à la BARQUETTE (unité réelle, non regroupée) → barquette", () => {
    const u = uniteGestion({ salesUnit: "BARQ", salesQtyPerPackUnit: 1 });
    expect(u.uniteColis).toBe("barquette");
    expect(u.unitePhysique).toBe("barquette");
    expect(u.physParColis).toBe(1);
  });
  it("barquettes REGROUPÉES en colis (salPackUn > 1) → colis (règle Gervifrais)", () => {
    const u = uniteGestion({ salesUnit: "barq", salesQtyPerPackUnit: 8 });
    expect(u.uniteColis).toBe("colis");
  });
  it("salesUnit vide → fallback inventoryUnit, sinon colis", () => {
    expect(uniteGestion({ salesUnit: null, inventoryUnit: "BQT", salesQtyPerPackUnit: 1 }).uniteColis).toBe("barquette");
    expect(uniteGestion({ salesUnit: "", inventoryUnit: null }).uniteColis).toBe("colis");
  });
});

describe("quantitePhysique — colis dispo → quantité physique", () => {
  it("10 colis de 4 kg = 40 kg", () => {
    const u = uniteGestion({ salesUnit: "KG", salesUnitWeight: 1, salesQtyPerPackUnit: 4, salesItemsPerUnit: 1 });
    expect(quantitePhysique(10, u)).toBe(40);
  });
  it("article au colis : 7 colis = 7 (unité de gestion = colis)", () => {
    const u = uniteGestion({ salesUnit: "pie", salesQtyPerPackUnit: 12 });
    expect(quantitePhysique(7, u)).toBe(7);
  });
  it("arrondi 3 décimales (12 × 0.125 kg)", () => {
    const u = uniteGestion({ salesUnit: "KG", salesUnitWeight: 0.125, salesQtyPerPackUnit: 12, salesItemsPerUnit: 1 });
    expect(quantitePhysique(3, u)).toBe(4.5);
  });
});

describe("libelleUnite — accord", () => {
  it("kg et colis invariables", () => {
    expect(libelleUnite("kg", 12)).toBe("kg");
    expect(libelleUnite("colis", 12)).toBe("colis");
  });
  it("barquette s'accorde à partir de 2", () => {
    expect(libelleUnite("barquette", 1)).toBe("barquette");
    expect(libelleUnite("barquette", 2)).toBe("barquettes");
  });
});

describe("scenariosTransformation — cas nominal divisible (40 kg → colis de 5 kg)", () => {
  it("8 colis exacts, recommandé, reste/manque/perte 0", () => {
    const s = scenariosTransformation({ disponible: 40, cible: 5 });
    expect(s[0]).toEqual({
      nbColis: 8, quantiteNecessaire: 40, quantiteUtilisee: 40,
      reste: 0, manque: 0, perte: 0, ecart: 0, exact: true, recommande: true,
    });
  });
  it("propose aussi les voisins (7 et 9), triés par écart, non recommandés", () => {
    const s = scenariosTransformation({ disponible: 40, cible: 5 });
    expect(s.map((x) => x.nbColis)).toEqual([8, 7, 9]);
    expect(s[1].recommande).toBe(false);
    expect(s[1].reste).toBe(5);     // 7 colis = 35 kg → reste 5
    expect(s[2].manque).toBe(5);    // 9 colis = 45 kg → manque 5
  });
});

describe("scenariosTransformation — cas non divisible (40 kg → colis de 6 kg)", () => {
  const s = scenariosTransformation({ disponible: 40, cible: 6 });
  it("le moindre écart (7 colis, manque 2) est recommandé en tête", () => {
    expect(s[0].nbColis).toBe(7);
    expect(s[0].quantiteNecessaire).toBe(42);
    expect(s[0].quantiteUtilisee).toBe(40); // on consomme tout le dispo
    expect(s[0].manque).toBe(2);
    expect(s[0].reste).toBe(0);
    expect(s[0].ecart).toBe(2);
    expect(s[0].exact).toBe(false);
    expect(s[0].recommande).toBe(true);
  });
  it("l'encadrant bas (6 colis = 36 kg, reste 4) est proposé juste après", () => {
    expect(s[1].nbColis).toBe(6);
    expect(s[1].quantiteUtilisee).toBe(36);
    expect(s[1].reste).toBe(4);
    expect(s[1].manque).toBe(0);
    expect(s[1].ecart).toBe(4);
  });
  it("4 scénarios maxi par défaut, écarts croissants", () => {
    expect(s.length).toBeLessThanOrEqual(4);
    for (let i = 1; i < s.length; i++) expect(s[i].ecart).toBeGreaterThanOrEqual(s[i - 1].ecart);
  });
});

describe("scenariosTransformation — perte (entame de colis source)", () => {
  it("40 kg en colis source de 4 kg → cible 7 kg : 5 colis = 35 kg, 9e colis entamé → perte 1, reste 4", () => {
    const s = scenariosTransformation({ disponible: 40, cible: 7, colisSource: 4 });
    const cinq = s.find((x) => x.nbColis === 5)!;
    expect(cinq.quantiteUtilisee).toBe(35);
    expect(cinq.perte).toBe(1);   // ⌈35/4⌉ = 9 colis ouverts = 36 kg → 1 kg d'entame
    expect(cinq.reste).toBe(4);   // 40 − 35 − 1
  });
  it("utilisé aligné sur les colis source → perte 0 (40 kg, cible 6 : 36 kg = 9×4)", () => {
    const s = scenariosTransformation({ disponible: 40, cible: 6, colisSource: 4 });
    const six = s.find((x) => x.nbColis === 6)!;
    expect(six.perte).toBe(0);
    expect(six.reste).toBe(4);
  });
  it("scénario « au-dessus » (manque) : tout est consommé, perte 0", () => {
    const s = scenariosTransformation({ disponible: 40, cible: 6, colisSource: 4 });
    const sept = s.find((x) => x.nbColis === 7)!;
    expect(sept.perte).toBe(0);
    expect(sept.manque).toBe(2);
  });
});

describe("scenariosTransformation — pas (recette : multiple de parentQty)", () => {
  it("nbColis multiples de 3 (40/5 = 8 → encadrants 6 et 9)", () => {
    const s = scenariosTransformation({ disponible: 40, cible: 5, pas: 3 });
    expect(s.every((x) => x.nbColis % 3 === 0)).toBe(true);
    expect(s[0].nbColis).toBe(9);  // 45 nécessaires, manque 5 — moindre écart
    expect(s[1].nbColis).toBe(6);  // 30 utilisés, reste 10
  });
  it("écart égal entre floor et ceil → floor (reste) préféré au manque", () => {
    // dispo 15, cible 2 : floor 7 (reste 1) / ceil 8 (manque 1) — égalité → 7 d'abord
    const s = scenariosTransformation({ disponible: 15, cible: 2 });
    expect(s[0].nbColis).toBe(7);
    expect(s[0].reste).toBe(1);
    expect(s[1].nbColis).toBe(8);
    expect(s[1].manque).toBe(1);
  });
});

describe("scenariosTransformation — cas limites", () => {
  it("cible ≤ 0 → []", () => {
    expect(scenariosTransformation({ disponible: 40, cible: 0 })).toEqual([]);
    expect(scenariosTransformation({ disponible: 40, cible: -2 })).toEqual([]);
  });
  it("disponible ≤ 0 → []", () => {
    expect(scenariosTransformation({ disponible: 0, cible: 5 })).toEqual([]);
    expect(scenariosTransformation({ disponible: -1, cible: 5 })).toEqual([]);
  });
  it("cible > disponible → jamais 0 colis : 1 colis avec son manque", () => {
    const s = scenariosTransformation({ disponible: 4, cible: 6 });
    expect(s[0].nbColis).toBe(1);
    expect(s[0].quantiteUtilisee).toBe(4);
    expect(s[0].manque).toBe(2);
    expect(s.every((x) => x.nbColis >= 1)).toBe(true);
  });
  it("quantités décimales : 12,5 kg → colis de 2,5 kg = 5 colis exacts", () => {
    const s = scenariosTransformation({ disponible: 12.5, cible: 2.5 });
    expect(s[0].nbColis).toBe(5);
    expect(s[0].exact).toBe(true);
  });
  it("tolérance flottante : 0.1+0.2 ≈ 0.3 tombe juste", () => {
    const s = scenariosTransformation({ disponible: 0.1 + 0.2, cible: 0.3 });
    expect(s[0].nbColis).toBe(1);
    expect(s[0].exact).toBe(true);
  });
  it("maxScenarios respecté", () => {
    expect(scenariosTransformation({ disponible: 40, cible: 6, maxScenarios: 2 }).length).toBe(2);
  });
  it("unité colis (pas de kg) : 10 colis → lots de 3 → 3 lots (reste 1) / 4 lots (manque 2)", () => {
    const s = scenariosTransformation({ disponible: 10, cible: 3 });
    expect(s[0].nbColis).toBe(3);
    expect(s[0].reste).toBe(1);
    expect(s[1].nbColis).toBe(4);
    expect(s[1].manque).toBe(2);
  });
});
