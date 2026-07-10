import { describe, it, expect } from "vitest";
import { ean13Checksum, normalizeEan13, ean13Modules, ean13Svg } from "./ean13";

/**
 * EAN-13 — encodage GS1 standard. Cas calibrés sur le BL SAP réel
 * (3 540900 000078 : code Gervifrais visible sur l'édition Crystal).
 */
describe("ean13 — clé de contrôle & normalisation", () => {
  it("clé du code Gervifrais 354090000007 → 8 (3 540900 000078)", () => {
    expect(ean13Checksum("354090000007")).toBe(8);
  });

  it("clé du classique 400638133393 → 1", () => {
    expect(ean13Checksum("400638133393")).toBe(1);
  });

  it("12 chiffres → complété avec sa clé", () => {
    expect(normalizeEan13("354090000007")).toBe("3540900000078");
  });

  it("13 chiffres avec clé correcte → accepté tel quel", () => {
    expect(normalizeEan13("3540900000078")).toBe("3540900000078");
  });

  it("13 chiffres avec clé fausse → null", () => {
    expect(normalizeEan13("3540900000071")).toBe(null);
  });

  it("vide / null / non numérique / longueur inattendue → null", () => {
    expect(normalizeEan13("")).toBe(null);
    expect(normalizeEan13(null)).toBe(null);
    expect(normalizeEan13("ABC")).toBe(null);
    expect(normalizeEan13("12345")).toBe(null);
  });
});

describe("ean13 — modules", () => {
  it("95 modules, gardes 101 / 01010 / 101 aux bons offsets", () => {
    const bits = ean13Modules("3540900000078");
    expect(bits).toHaveLength(95);
    expect(bits.slice(0, 3)).toBe("101");
    expect(bits.slice(45, 50)).toBe("01010");
    expect(bits.slice(92)).toBe("101");
  });

  it("cas de référence GS1 : 4006381333931", () => {
    // Vecteur connu : premier chiffre 4 → parité LGLLGG ; le 2e chiffre (0)
    // encodé en L = 0001101 juste après la garde gauche.
    const bits = ean13Modules("4006381333931");
    expect(bits.slice(3, 10)).toBe("0001101");
  });
});

describe("ean13 — SVG", () => {
  it("code valide → SVG avec barres et libellé groupé « 3 540900 000078 »", () => {
    const svg = ean13Svg("3540900000078");
    expect(svg).toContain("<svg");
    expect(svg).toContain("3 540900 000078");
    expect(svg).toContain("<rect");
  });

  it("code invalide → null (l'appelant affiche « Code is empty »)", () => {
    expect(ean13Svg("oops")).toBe(null);
  });
});
