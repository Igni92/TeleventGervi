import { describe, it, expect } from "vitest";
import {
  periodBounds,
  previousYearBounds,
  annualWindowStart,
  ANNUAL_MATRIX_YEARS_BACK,
} from "./pilotage-time";

describe("periodBounds", () => {
  it("day = jour entier 00:00 → 24:00", () => {
    const ref = new Date(2026, 5, 3, 14, 30, 0); // 3 juin 2026 14:30
    const b = periodBounds("day", ref);
    expect(b.start.getDate()).toBe(3);
    expect(b.start.getHours()).toBe(0);
    expect(b.end.getDate()).toBe(4);
  });

  it("week = lundi → lundi suivant", () => {
    const wed = new Date(2026, 5, 3); // mercredi 3 juin 2026
    const b = periodBounds("week", wed);
    expect(b.start.getDay()).toBe(1); // lundi
    expect(b.end.getDay()).toBe(1);
    expect((b.end.getTime() - b.start.getTime()) / 86400000).toBe(7);
  });

  it("week sur un dimanche → semaine qui se termine ce dimanche", () => {
    const sun = new Date(2026, 5, 7); // dim 7 juin 2026
    const b = periodBounds("week", sun);
    expect(b.start.getDay()).toBe(1);                                      // lundi 1er juin
    expect(b.start.getDate()).toBe(1);
  });

  it("month = 1er du mois → 1er du suivant", () => {
    const ref = new Date(2026, 5, 15);
    const b = periodBounds("month", ref);
    expect(b.start.getMonth()).toBe(5);
    expect(b.start.getDate()).toBe(1);
    expect(b.end.getMonth()).toBe(6);
    expect(b.end.getDate()).toBe(1);
  });

  it("year = 1er janvier → 1er janvier suivant", () => {
    const ref = new Date(2026, 5, 3);
    const b = periodBounds("year", ref);
    expect(b.start.getFullYear()).toBe(2026);
    expect(b.start.getMonth()).toBe(0);
    expect(b.end.getFullYear()).toBe(2027);
  });
});

describe("previousYearBounds — YoY aligné à la granularité", () => {
  it("day → même jour de la semaine N-1 (mardi vs mardi)", () => {
    // jeudi 4 juin 2026 — N-1 calendaire (4 juin 2025) tombe un MERCREDI.
    // L'alignement doit décaler à jeudi 5 juin 2025 (delta +1).
    const ref = new Date(2026, 5, 4);
    expect(ref.getDay()).toBe(4);                                  // jeudi
    const curr = periodBounds("day", ref);
    const prev = previousYearBounds(curr, "day");
    expect(prev.start.getDay()).toBe(4);                           // même DoW
    expect(prev.start.getFullYear()).toBe(2025);
  });

  it("day → samedi vs samedi (cas du user)", () => {
    // samedi 6 juin 2026 — N-1 (6 juin 2025) = VENDREDI. Décale à samedi 7 juin 2025.
    const ref = new Date(2026, 5, 6);
    expect(ref.getDay()).toBe(6);                                  // samedi
    const curr = periodBounds("day", ref);
    const prev = previousYearBounds(curr, "day");
    expect(prev.start.getDay()).toBe(6);
    // delta ne dépasse jamais ±3 jours du calendaire N-1
    const deltaDays = Math.abs((prev.start.getDate() - 6));
    expect(deltaDays).toBeLessThanOrEqual(3);
  });

  it("week → semaine lundi-dimanche contenant start - 1 an", () => {
    const ref = new Date(2026, 5, 3);                              // mercredi 3 juin 2026
    const curr = periodBounds("week", ref);
    const prev = previousYearBounds(curr, "week");
    expect(prev.start.getDay()).toBe(1);                           // toujours lundi
    expect((prev.end.getTime() - prev.start.getTime()) / 86400000).toBe(7);
    expect(prev.start.getFullYear()).toBe(curr.start.getFullYear() - 1);
  });

  it("month → 1er du même mois N-1", () => {
    const ref = new Date(2026, 5, 15);
    const curr = periodBounds("month", ref);
    const prev = previousYearBounds(curr, "month");
    expect(prev.start.getFullYear()).toBe(2025);
    expect(prev.start.getMonth()).toBe(5);                         // même mois (juin)
    expect(prev.start.getDate()).toBe(1);
  });

  it("year → année calendaire N-1", () => {
    const ref = new Date(2026, 5, 3);
    const curr = periodBounds("year", ref);
    const prev = previousYearBounds(curr, "year");
    expect(prev.start.getFullYear()).toBe(2025);
    expect(prev.start.getMonth()).toBe(0);
    expect(prev.end.getFullYear()).toBe(2026);
  });

  it("rétro-compat : sans paramètre g, comportement = mois", () => {
    const ref = new Date(2026, 5, 15);
    const curr = periodBounds("month", ref);
    const prev = previousYearBounds(curr);                         // pas de g
    expect(prev.start.getFullYear()).toBe(2025);
    expect(prev.start.getMonth()).toBe(5);
  });
});

describe("annualWindowStart — borne basse synchro = borne basse rapport annuel", () => {
  it("défaut = 1er janvier de N-2 (matrice 3 ans : N-2, N-1, N)", () => {
    const ref = new Date(2026, 6, 8); // 8 juillet 2026 (milieu d'année)
    const s = annualWindowStart(ANNUAL_MATRIX_YEARS_BACK, ref);
    expect(s.getFullYear()).toBe(2024);   // 2026 - 2
    expect(s.getMonth()).toBe(0);         // janvier
    expect(s.getDate()).toBe(1);
  });

  it("couvre TOUTE l'année N-2 même en fin d'année N (pas de fenêtre glissante 365j)", () => {
    // Le 31 déc 2026, une fenêtre « today − 1 an » démarrerait fin 2025 et
    // laisserait 2024 + le début 2025 hors miroir → colonnes vides. La borne
    // calendaire, elle, reste au 1er janvier 2024.
    const ref = new Date(2026, 11, 31);
    const s = annualWindowStart(ANNUAL_MATRIX_YEARS_BACK, ref);
    expect(s.getTime()).toBe(new Date(2024, 0, 1).getTime());
  });

  it("respecte un yearsBack explicite", () => {
    const ref = new Date(2026, 0, 15);
    expect(annualWindowStart(4, ref).getFullYear()).toBe(2022);
  });
});
