import { describe, it, expect } from "vitest";
import {
  nextDeliveryDate,
  addDaysISO,
  isoDayOfWeek,
  frenchHolidayLabel,
  isNonDeliveryDay,
  nextWorkingDeliveryDay,
  nextPossibleDeliveryDay,
  isPrecommande,
  isDepartureReached,
} from "./livraison";

describe("livraison — prochaine date de livraison (J+1, samedi → J+2)", () => {
  it("un mardi → livraison le mercredi (J+1)", () => {
    // 16 juin 2026 = mardi (heure de Paris).
    const ref = new Date("2026-06-16T09:00:00Z");
    expect(nextDeliveryDate(ref)).toBe("2026-06-17");
  });

  it("un vendredi → livraison le samedi (J+1)", () => {
    // 19 juin 2026 = vendredi.
    const ref = new Date("2026-06-19T09:00:00Z");
    expect(nextDeliveryDate(ref)).toBe("2026-06-20");
  });

  it("un samedi → livraison le lundi (J+2, on saute le dimanche)", () => {
    // 20 juin 2026 = samedi.
    const ref = new Date("2026-06-20T09:00:00Z");
    expect(nextDeliveryDate(ref)).toBe("2026-06-22");
  });

  it("un dimanche → livraison le lundi (J+1)", () => {
    // 21 juin 2026 = dimanche.
    const ref = new Date("2026-06-21T09:00:00Z");
    expect(nextDeliveryDate(ref)).toBe("2026-06-22");
  });

  it("raisonne en heure de Paris (soir UTC = lendemain à Paris)", () => {
    // Samedi 20 juin 22:30 UTC → dimanche 21/06 00:30 à Paris → J+1 = lundi 22.
    const ref = new Date("2026-06-20T22:30:00Z");
    expect(nextDeliveryDate(ref)).toBe("2026-06-22");
  });
});

describe("livraison — arithmétique de dates ISO", () => {
  it("addDaysISO traverse un changement de mois", () => {
    expect(addDaysISO("2026-01-31", 1)).toBe("2026-02-01");
    expect(addDaysISO("2026-12-31", 1)).toBe("2027-01-01");
  });

  it("isoDayOfWeek : 0 = dimanche … 6 = samedi", () => {
    expect(isoDayOfWeek("2026-06-21")).toBe(0); // dimanche
    expect(isoDayOfWeek("2026-06-20")).toBe(6); // samedi
    expect(isoDayOfWeek("2026-06-16")).toBe(2); // mardi
  });
});

describe("livraison — jours fériés français", () => {
  it("détecte les fériés fixes", () => {
    expect(frenchHolidayLabel("2026-01-01")).toBe("Jour de l'An");
    expect(frenchHolidayLabel("2026-05-01")).toBe("Fête du Travail");
    expect(frenchHolidayLabel("2026-07-14")).toBe("Fête nationale");
    expect(frenchHolidayLabel("2026-12-25")).toBe("Noël");
  });

  it("détecte les fériés mobiles (Pâques 2026 = 5 avril)", () => {
    expect(frenchHolidayLabel("2026-04-06")).toBe("Lundi de Pâques");
    expect(frenchHolidayLabel("2026-05-14")).toBe("Ascension");
    expect(frenchHolidayLabel("2026-05-25")).toBe("Lundi de Pentecôte");
  });

  it("un jour ordinaire n'est pas férié", () => {
    expect(frenchHolidayLabel("2026-06-17")).toBeNull();
  });
});

describe("livraison — report sur jour ouvré", () => {
  it("un dimanche n'est pas livrable", () => {
    expect(isNonDeliveryDay("2026-06-21")).toBe(true);
  });

  it("un férié n'est pas livrable", () => {
    expect(isNonDeliveryDay("2026-05-01")).toBe(true);
  });

  it("reporte le 1er mai (vendredi férié) au samedi 2 mai (samedi = livrable)", () => {
    expect(nextWorkingDeliveryDay("2026-05-01")).toBe("2026-05-02");
  });

  it("reporte un dimanche au lundi suivant", () => {
    // 3 mai 2026 = dimanche → lundi 4 mai.
    expect(nextWorkingDeliveryDay("2026-05-03")).toBe("2026-05-04");
  });

  it("laisse inchangé un jour déjà ouvré", () => {
    expect(nextWorkingDeliveryDay("2026-06-17")).toBe("2026-06-17");
  });
});

describe("livraison — précommande (livraison au-delà du prochain jour livrable)", () => {
  it("mardi : livraison mercredi (J+1) = NORMAL, jeudi = PRÉCOMMANDE", () => {
    const ref = new Date("2026-06-16T09:00:00Z"); // mardi
    expect(nextPossibleDeliveryDay(ref)).toBe("2026-06-17"); // mercredi
    expect(isPrecommande("2026-06-17", ref)).toBe(false);    // J+1 → BL normal
    expect(isPrecommande("2026-06-18", ref)).toBe(true);     // J+2 → précommande
  });

  it("samedi : prochaine livraison lundi = NORMAL, mardi = PRÉCOMMANDE", () => {
    const ref = new Date("2026-06-20T09:00:00Z"); // samedi
    expect(nextPossibleDeliveryDay(ref)).toBe("2026-06-22"); // lundi (saute dimanche)
    expect(isPrecommande("2026-06-22", ref)).toBe(false);
    expect(isPrecommande("2026-06-23", ref)).toBe(true);
  });

  it("veille d'un férié : le J+1 férié est sauté → prochaine livraison = jour ouvré suivant", () => {
    // Lundi 13/07/2026 : J+1 = mardi 14 (Fête nationale, férié) → sauté → mercredi 15.
    const ref = new Date("2026-07-13T09:00:00Z");
    expect(nextPossibleDeliveryDay(ref)).toBe("2026-07-15");
    expect(isPrecommande("2026-07-14", ref)).toBe(false); // le férié n'est pas « au-delà »
    expect(isPrecommande("2026-07-15", ref)).toBe(false); // prochaine livraison réelle
    expect(isPrecommande("2026-07-16", ref)).toBe(true);  // au-delà → précommande
  });

  it("accepte un datetime ISO (compare la partie date seulement)", () => {
    const ref = new Date("2026-06-16T09:00:00Z");
    expect(isPrecommande("2026-06-18T09:00:00.000Z", ref)).toBe(true);
    expect(isPrecommande("", ref)).toBe(false);
  });
});

describe("livraison — jour de départ atteint (offre client à passer en commande)", () => {
  it("est l'exact complément d'isPrecommande pour une date lisible", () => {
    const ref = new Date("2026-06-16T09:00:00Z"); // mardi
    // Précommande (jeudi) → PAS encore à passer.
    expect(isDepartureReached("2026-06-18", ref)).toBe(false);
    // Entrée dans la fenêtre livrable (mercredi J+1) → à passer.
    expect(isDepartureReached("2026-06-17", ref)).toBe(true);
  });
  it("une date passée est « départ atteint » (offre en retard à traiter)", () => {
    const ref = new Date("2026-06-16T09:00:00Z");
    expect(isDepartureReached("2026-06-10", ref)).toBe(true);
  });
  it("une date illisible n'alerte pas (false)", () => {
    const ref = new Date("2026-06-16T09:00:00Z");
    expect(isDepartureReached("", ref)).toBe(false);
    expect(isDepartureReached("nope", ref)).toBe(false);
  });
});
