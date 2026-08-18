import { describe, it, expect } from "vitest";
import {
  normalizePalettes, totalPalettes, isEmptyPalettes, sumPalettes,
  formatPalettes, PALETTE_TYPES, EMPTY_PALETTES,
} from "./palettes";

/**
 * Comptage de palettes par BL. Module PUR → test hors-ligne.
 * L'enjeu : une saisie douteuse (champ vide, texte, décimale, type inconnu) ne
 * doit JAMAIS produire de total faux sur le bon de transport du chauffeur.
 */
describe("palettes — normalisation d'une saisie", () => {
  it("lit un comptage complet", () => {
    expect(normalizePalettes({ demi: 1, medium: 2, europe: 0, xl: 3 }))
      .toEqual({ demi: 1, medium: 2, europe: 0, xl: 3 });
  });

  it("complète les types absents à 0", () => {
    expect(normalizePalettes({ medium: 2 })).toEqual({ demi: 0, medium: 2, europe: 0, xl: 0 });
  });

  it("ignore les valeurs inexploitables (texte, vide, négatif, NaN)", () => {
    expect(normalizePalettes({ demi: "", medium: "deux", europe: -3, xl: NaN }))
      .toEqual(EMPTY_PALETTES);
  });

  it("accepte une saisie numérique en texte (champ de formulaire)", () => {
    expect(normalizePalettes({ xl: "2" })).toMatchObject({ xl: 2 });
  });

  it("tronque les décimales — une demi-palette est un TYPE, pas 0,5", () => {
    expect(normalizePalettes({ demi: 2.9 })).toMatchObject({ demi: 2 });
  });

  it("résiste à null/undefined/scalaire", () => {
    expect(normalizePalettes(null)).toEqual(EMPTY_PALETTES);
    expect(normalizePalettes(undefined)).toEqual(EMPTY_PALETTES);
    expect(normalizePalettes(42)).toEqual(EMPTY_PALETTES);
  });

  it("ignore un type inconnu", () => {
    expect(normalizePalettes({ medium: 1, cagette: 99 })).toEqual({ demi: 0, medium: 1, europe: 0, xl: 0 });
  });
});

describe("palettes — totaux et cumul", () => {
  it("totalise toutes tailles confondues", () => {
    expect(totalPalettes({ demi: 1, medium: 2, europe: 0, xl: 3 })).toBe(6);
  });

  it("distingue « rien saisi » (case à remplir à la main)", () => {
    expect(isEmptyPalettes(EMPTY_PALETTES)).toBe(true);
    expect(isEmptyPalettes({ ...EMPTY_PALETTES, demi: 1 })).toBe(false);
  });

  it("cumule plusieurs BL pour le bon de transport", () => {
    expect(sumPalettes([
      { demi: 1, medium: 2, europe: 0, xl: 0 },
      { demi: 0, medium: 1, europe: 3, xl: 1 },
    ])).toEqual({ demi: 1, medium: 3, europe: 3, xl: 1 });
  });

  it("cumul d'une liste vide = aucun palette", () => {
    expect(sumPalettes([])).toEqual(EMPTY_PALETTES);
  });

  it("Medium et Europe restent SÉPARÉES malgré le même format 80×120", () => {
    const m = PALETTE_TYPES.find((t) => t.key === "medium")!;
    const e = PALETTE_TYPES.find((t) => t.key === "europe")!;
    expect(m.size).toBe(e.size);
    expect(sumPalettes([{ demi: 0, medium: 2, europe: 5, xl: 0 }]))
      .toMatchObject({ medium: 2, europe: 5 });
  });
});

describe("palettes — résumé imprimé", () => {
  it("n'affiche que les types comptés", () => {
    expect(formatPalettes({ demi: 0, medium: 2, europe: 0, xl: 1 })).toBe("2 Medium · 1 XL");
  });
  it("chaîne vide quand rien n'est compté", () => {
    expect(formatPalettes(EMPTY_PALETTES)).toBe("");
  });
});
