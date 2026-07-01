import { describe, it, expect } from "vitest";
import { computeInsights, pickupSlotLabel } from "./insights";
import { parisHourMinute } from "./paris-time";

/** Date récente (dans la fenêtre 90 j) à une heure UTC contrôlée. */
function recent(daysAgo: number, utcHour: number, utcMin = 0): Date {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - daysAgo);
  d.setUTCHours(utcHour, utcMin, 0, 0);
  return d;
}

describe("parisHourMinute — extraction heure murale de Paris (fix UTC)", () => {
  it("été (UTC+2) : 08:30 UTC → 10:30 Paris", () => {
    expect(parisHourMinute(new Date("2026-07-01T08:30:00Z"))).toEqual({ hour: 10, minute: 30 });
  });
  it("hiver (UTC+1) : 08:30 UTC → 09:30 Paris", () => {
    expect(parisHourMinute(new Date("2026-01-15T08:30:00Z"))).toEqual({ hour: 9, minute: 30 });
  });
});

describe("computeInsights — le DÉCROCHÉ prime sur la densité de commande", () => {
  // Heure A : beaucoup de commandes mais 50 % de décroché.
  // Heure B : moins de commandes mais 100 % de décroché.
  const A = recent(3, 6);   // 06:00 UTC
  const B = recent(3, 14);  // 14:00 UTC (≥2 h plus tard → heure Paris différente)
  const appels = [
    { type: "COMMANDE", outcome: "COMMANDE", heureAppel: A },
    { type: "COMMANDE", outcome: "COMMANDE", heureAppel: A },
    { type: "COMMANDE", outcome: "COMMANDE", heureAppel: A },
    { type: "DEMAIN", outcome: "NRP", heureAppel: A },
    { type: "DEMAIN", outcome: "NRP", heureAppel: A },
    { type: "DEMAIN", outcome: "NRP", heureAppel: A },
    { type: "COMMANDE", outcome: "COMMANDE", heureAppel: B },
    { type: "DEMAIN", outcome: "RAPPELE", heureAppel: B },
    { type: "DEMAIN", outcome: "REFUS", heureAppel: B },
  ];
  const i = computeInsights(appels);

  it("bestPickup = créneau où le client décroche le plus (heure B, en Paris)", () => {
    expect(i.bestPickup).not.toBeNull();
    expect(i.bestPickup!.hour).toBe(parisHourMinute(B).hour);
    expect(i.bestPickup!.rate).toBe(100);
  });

  it("bestHour (densité commande) = heure A → distincte du décroché", () => {
    expect(i.bestHour!.hour).toBe(parisHourMinute(A).hour);
    expect(i.bestHour!.hour).not.toBe(i.bestPickup!.hour);
  });

  it("recommendedHour (tri de la file) suit le décroché, pas la densité", () => {
    expect(i.recommendedHour).toBe(parisHourMinute(B).hour);
  });

  it("answerRate global = décrochés / tentatives (6/9 ≈ 67 %)", () => {
    expect(i.attemptsCount).toBe(9);
    expect(i.connectedCount).toBe(6);
    expect(i.answerRate).toBe(67);
  });
});

describe("computeInsights — NRP/répondeur comptés comme tentatives, pas décrochés", () => {
  it("un NRP est une tentative sans décroché", () => {
    const i = computeInsights([
      { type: "DEMAIN", outcome: "NRP", heureAppel: recent(1, 9) },
      { type: "DEMAIN", outcome: "REPONDEUR", heureAppel: recent(1, 9) },
    ]);
    expect(i.attemptsCount).toBe(2);
    expect(i.connectedCount).toBe(0);
    expect(i.answerRate).toBe(0);
  });

  it("historique legacy sans `outcome` = contact établi (rétrocompat)", () => {
    const i = computeInsights([
      { type: "COMMANDE", heureAppel: recent(2, 9) },
      { type: "DEMAIN", heureAppel: recent(2, 9) },
    ]);
    expect(i.attemptsCount).toBe(2);
    expect(i.connectedCount).toBe(2);
  });
});

describe("computeInsights — statut de cadence", () => {
  it("en retard quand la dernière commande dépasse 1,5× l'intervalle médian", () => {
    // 4 commandes espacées ~10 j, la dernière il y a ~40 j → overdue.
    const appels = [40, 50, 60, 70].map((d) => ({
      type: "COMMANDE" as const, outcome: "COMMANDE", heureAppel: recent(d, 9),
    }));
    const i = computeInsights(appels);
    expect(i.medianIntervalDays).toBe(10);
    expect(i.cadenceStatus).toBe("overdue");
  });
});

describe("pickupSlotLabel", () => {
  it("créneau 30 min", () => {
    expect(pickupSlotLabel({ hour: 14, minute: 30, rate: 80, attempts: 5, granularity: "30min" })).toBe("14h30–15h");
    expect(pickupSlotLabel({ hour: 9, minute: 0, rate: 80, attempts: 5, granularity: "30min" })).toBe("9h–9h30");
  });
  it("repli heure pleine", () => {
    expect(pickupSlotLabel({ hour: 10, minute: 0, rate: 70, attempts: 8, granularity: "hour" })).toBe("10h–11h");
  });
});
