import { describe, it, expect } from "vitest";
import { matchTarifFruit, priceForArticle, sanitizeTarifFruitRows, type TarifFruitRow } from "./tarifFruits";

const rows: TarifFruitRow[] = [
  { family: "fraise", pays: "Belgique", calibre: "3AE", price: 6.2 },
  { family: "fraise", pays: "Belgique", calibre: "2AE", price: 5.8 },
  { family: "fraise", pays: "Belgique", price: 5.5 },          // tous calibres Belgique
  { family: "framboise", pays: "Portugal", price: 4.5 },
  { family: "framboise", price: 4.0 },                          // toutes origines
];

describe("tarifFruits — matchTarifFruit (ligne la plus précise)", () => {
  it("prend le calibre exact quand il est renseigné", () => {
    expect(priceForArticle(rows, { family: "fraise", pays: "Belgique", calibre: "3AE" })).toBe(6.2);
    expect(priceForArticle(rows, { family: "fraise", pays: "Belgique", calibre: "2AE" })).toBe(5.8);
  });

  it("retombe sur la ligne famille+origine quand le calibre ne matche pas", () => {
    expect(priceForArticle(rows, { family: "fraise", pays: "Belgique", calibre: "1AE" })).toBe(5.5);
  });

  it("préfère la ligne la plus précise (origine) à la ligne générique", () => {
    expect(priceForArticle(rows, { family: "framboise", pays: "Portugal", calibre: "X" })).toBe(4.5);
    expect(priceForArticle(rows, { family: "framboise", pays: "Espagne" })).toBe(4.0);
  });

  it("comparaison insensible à la casse / espaces", () => {
    expect(priceForArticle(rows, { family: "FRAISE", pays: " belgique ", calibre: "3ae" })).toBe(6.2);
  });

  it("aucune famille correspondante → null", () => {
    expect(priceForArticle(rows, { family: "myrtille", pays: "Belgique" })).toBeNull();
    expect(matchTarifFruit(rows, { family: "" })).toBeNull();
  });
});

describe("tarifFruits — sanitizeTarifFruitRows", () => {
  it("rejette famille vide / prix invalide et dédoublonne par clé", () => {
    const out = sanitizeTarifFruitRows([
      { family: "Fraise", pays: "Belgique", calibre: "3AE", price: 6.2 },
      { family: "Fraise", pays: "belgique", calibre: "3ae", price: 6.5 }, // même clé (casse) → dernière gagne
      { family: "", price: 3 },                                            // rejetée (pas de famille)
      { family: "framboise", price: -1 },                                  // rejetée (prix < 0)
      { family: "framboise", price: 4 },                                   // ok
    ]);
    expect(out).toHaveLength(2);
    const fraise = out.find((r) => r.family === "fraise");
    expect(fraise?.price).toBe(6.5);      // la dernière a gagné
    expect(fraise?.pays).toBe("belgique");
    expect(out.find((r) => r.family === "framboise")?.price).toBe(4);
  });

  it("normalise famille en minuscules et vide les critères blancs en null", () => {
    const out = sanitizeTarifFruitRows([{ family: "FRAISE", pays: "  ", calibre: "3AE", price: 5 }]);
    expect(out[0]).toMatchObject({ family: "fraise", pays: null, calibre: "3AE", price: 5 });
  });
});
