import { describe, it, expect } from "vitest";
import { parisStartOfDay, parisEndOfDay, parisDayOfWeek } from "./paris-time";

describe("paris-time — jour ouvré en Europe/Paris (serveur UTC)", () => {
  it("été (CEST = UTC+2) : minuit Paris = 22:00 UTC la veille", () => {
    // 16 juin 2026 07:59 UTC → jour de Paris = 16/06, début = 15/06 22:00 UTC.
    const ref = new Date("2026-06-16T07:59:00Z");
    expect(parisStartOfDay(ref).toISOString()).toBe("2026-06-15T22:00:00.000Z");
    expect(parisDayOfWeek(ref)).toBe(2); // mardi
  });

  it("soirée UTC déjà le lendemain à Paris", () => {
    // 16 juin 2026 22:30 UTC → à Paris il est 17/06 00:30 (mercredi).
    const ref = new Date("2026-06-16T22:30:00Z");
    expect(parisStartOfDay(ref).toISOString()).toBe("2026-06-16T22:00:00.000Z");
    expect(parisDayOfWeek(ref)).toBe(3); // mercredi
  });

  it("hiver (CET = UTC+1) : minuit Paris = 23:00 UTC la veille", () => {
    const ref = new Date("2026-01-15T10:00:00Z");
    expect(parisStartOfDay(ref).toISOString()).toBe("2026-01-14T23:00:00.000Z");
    expect(parisDayOfWeek(ref)).toBe(4); // jeudi
  });

  it("fin de journée = début du jour suivant (fenêtre de 24h ouvrée)", () => {
    const ref = new Date("2026-06-16T07:59:00Z");
    const start = parisStartOfDay(ref);
    const end = parisEndOfDay(ref);
    expect(end.toISOString()).toBe("2026-06-16T22:00:00.000Z");
    expect((end.getTime() - start.getTime()) / 3600_000).toBe(24);
  });

  it("traverse le passage à l'heure d'hiver (jour de 25h)", () => {
    // Dimanche 25 oct. 2026 : retour à l'heure d'hiver (03:00→02:00 CEST→CET).
    const ref = new Date("2026-10-25T12:00:00Z");
    const start = parisStartOfDay(ref);
    const end = parisEndOfDay(ref);
    // Début 24/10 22:00 UTC (CEST), fin 25/10 23:00 UTC (CET) → 25h.
    expect((end.getTime() - start.getTime()) / 3600_000).toBe(25);
  });
});
