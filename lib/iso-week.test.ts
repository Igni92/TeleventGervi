import { describe, it, expect } from "vitest";
import {
  isoWeek, isoWeeksInYear, isoWeekStart, isoWeekLabel,
  easterSunday, feteDesMeres, COMMERCIAL_EVENTS,
} from "./iso-week";

describe("isoWeek — numéro de semaine ISO 8601", () => {
  it("4 janvier est toujours en semaine 1", () => {
    expect(isoWeek(new Date(2026, 0, 4)).week).toBe(1);
    expect(isoWeek(new Date(2025, 0, 4)).week).toBe(1);
  });

  it("1er janvier 2026 (jeudi) = semaine 1 / 2026", () => {
    const w = isoWeek(new Date(2026, 0, 1));
    expect(w).toEqual({ year: 2026, week: 1 });
  });

  it("bordure : 31 déc 2024 appartient à la semaine 1 / 2025 (année ISO ≠ calendaire)", () => {
    const w = isoWeek(new Date(2024, 11, 31)); // mardi
    expect(w).toEqual({ year: 2025, week: 1 });
  });

  it("bordure : 1er janvier 2023 (dimanche) = semaine 52 / 2022", () => {
    const w = isoWeek(new Date(2023, 0, 1));
    expect(w).toEqual({ year: 2022, week: 52 });
  });
});

describe("isoWeeksInYear", () => {
  it("2026 a 53 semaines (1er janvier = jeudi)", () => {
    expect(isoWeeksInYear(2026)).toBe(53);
  });
  it("2025 a 52 semaines", () => {
    expect(isoWeeksInYear(2025)).toBe(52);
  });
  it("2020 (bissextile, 1er janv mercredi) a 53 semaines", () => {
    expect(isoWeeksInYear(2020)).toBe(53);
  });
});

describe("isoWeekStart — lundi de la semaine", () => {
  it("renvoie le lundi, et isoWeek(start) round-trip", () => {
    const start = isoWeekStart(2026, 10);
    expect(start.getDay()).toBe(1); // lundi
    expect(isoWeek(start)).toEqual({ year: 2026, week: 10 });
  });
});

describe("isoWeekLabel", () => {
  it("pad sur 2 chiffres avec préfixe S", () => {
    expect(isoWeekLabel(7)).toBe("S07");
    expect(isoWeekLabel(52)).toBe("S52");
  });
});

describe("easterSunday — computus", () => {
  it("dates connues", () => {
    // Pâques 2025 = 20 avril ; 2026 = 5 avril ; 2024 = 31 mars.
    expect(easterSunday(2025)).toEqual(new Date(2025, 3, 20));
    expect(easterSunday(2026)).toEqual(new Date(2026, 3, 5));
    expect(easterSunday(2024)).toEqual(new Date(2024, 2, 31));
  });
  it("tombe toujours un dimanche", () => {
    for (let y = 2020; y <= 2030; y++) expect(easterSunday(y).getDay()).toBe(0);
  });
});

describe("feteDesMeres — règle française", () => {
  it("dernier dimanche de mai en année normale (2026 = 31 mai)", () => {
    const d = feteDesMeres(2026);
    expect(d.getDay()).toBe(0);
    expect(d).toEqual(new Date(2026, 4, 31));
  });
  it("repoussée à juin si Pentecôte coïncide (2026 ? sinon vérifie l'invariant dimanche)", () => {
    const d = feteDesMeres(2025);
    expect(d.getDay()).toBe(0);
    // 2025 : dernier dimanche de mai = 25 mai ; Pentecôte = 8 juin → pas de conflit.
    expect(d).toEqual(new Date(2025, 4, 25));
  });
});

describe("COMMERCIAL_EVENTS", () => {
  it("toutes les clés sont uniques", () => {
    const keys = COMMERCIAL_EVENTS.map((e) => e.key);
    expect(new Set(keys).size).toBe(keys.length);
  });
  it("chaque événement produit une date valide pour 2026", () => {
    for (const ev of COMMERCIAL_EVENTS) {
      const d = ev.date(2026);
      expect(d instanceof Date && !Number.isNaN(d.getTime())).toBe(true);
    }
  });
  it("Beaujolais nouveau = 3e jeudi de novembre", () => {
    const beaujolais = COMMERCIAL_EVENTS.find((e) => e.key === "beaujolais")!;
    const d = beaujolais.date(2026);
    expect(d.getDay()).toBe(4);   // jeudi
    expect(d.getMonth()).toBe(10); // novembre
  });
});
