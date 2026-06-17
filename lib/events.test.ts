import { describe, it, expect } from "vitest";
import { eventsInWindow, relativeDayLabel } from "./events";

describe("events — fenêtre ±1 semaine autour d'une date", () => {
  it("inclut un événement proche avec le bon décalage", () => {
    // 23 déc. 2026 : Noël (25/12) à +2 j doit apparaître.
    const evs = eventsInWindow(new Date(2026, 11, 23));
    const noel = evs.find((e) => e.key === "noel");
    expect(noel).toBeTruthy();
    expect(noel!.daysFromRef).toBe(2);
  });

  it("gère le passage d'année (fin décembre voit le Nouvel An)", () => {
    // 29 déc. 2025 : Noël (25/12, il y a 4 j) ET Nouvel An (01/01/2026, dans 3 j).
    const evs = eventsInWindow(new Date(2025, 11, 29));
    const keys = evs.map((e) => e.key);
    expect(keys).toContain("noel");
    expect(keys).toContain("nouvel-an");
    expect(evs.find((e) => e.key === "nouvel-an")!.daysFromRef).toBe(3);
    expect(evs.find((e) => e.key === "noel")!.daysFromRef).toBe(-4);
    // Galette (06/01) est hors fenêtre (+8 j > 7).
    expect(keys).not.toContain("galette");
  });

  it("trié par date croissante", () => {
    const evs = eventsInWindow(new Date(2025, 11, 29));
    for (let i = 1; i < evs.length; i++) {
      expect(evs[i].date.getTime()).toBeGreaterThanOrEqual(evs[i - 1].date.getTime());
    }
  });

  it("fenêtre vide loin de tout événement (mi-août)", () => {
    expect(eventsInWindow(new Date(2026, 7, 12))).toHaveLength(0);
  });

  it("largeur de fenêtre paramétrable", () => {
    // Avec ±10 j depuis le 29/12/2025, la Galette (06/01, +8 j) entre.
    const evs = eventsInWindow(new Date(2025, 11, 29), { before: 10, after: 10 });
    expect(evs.map((e) => e.key)).toContain("galette");
  });

  it("libellés relatifs", () => {
    expect(relativeDayLabel(0)).toBe("aujourd'hui");
    expect(relativeDayLabel(1)).toBe("demain");
    expect(relativeDayLabel(-1)).toBe("hier");
    expect(relativeDayLabel(3)).toBe("dans 3 j");
    expect(relativeDayLabel(-2)).toBe("il y a 2 j");
  });
});
