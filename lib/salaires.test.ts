import { describe, it, expect } from "vitest";
import {
  avantageNatureAnnuel, avantageNatureMensuel, prorata13e, isTreiziemeMonth,
  missingElements, recapMailHtml, salaireMonthLabel,
  AN_ELECTRIQUE_PLAFOND_ANNUEL,
  type SalaryHeures, type VehiculeAN,
} from "./salaires";

const VEH: VehiculeAN = {
  type: "Clio V", energie: "diesel", immatriculation: "AA-123-BB",
  valeurAchat: 20000, plusDe5Ans: false, carburantRembourse: false, usage: "permanent",
};

const HEURES: SalaryHeures = {
  totalMin: 151 * 60 + 40, contractMin: 151 * 60 + 40,
  suppTotalMin: 0, suppPayEquivMin: 0, suppRecupEquivMin: 0, suppSansDecisionMin: 0,
  ferieMin: 0, congesMin: 0, cpJours: 0, maladieJours: 0, absentJours: 0, recupJours: 0,
  weeksWithData: 4, weeksTotal: 4,
};

describe("salaires — avantage en nature véhicule (forfait achat)", () => {
  it("15 % de la valeur d'achat (véhicule ≤ 5 ans, sans carburant)", () => {
    expect(avantageNatureAnnuel(VEH)).toBe(3000);
    expect(avantageNatureMensuel(VEH)).toBe(250);
  });
  it("10 % si plus de 5 ans ; 20 %/15 % carburant compris", () => {
    expect(avantageNatureAnnuel({ ...VEH, plusDe5Ans: true })).toBe(2000);
    expect(avantageNatureAnnuel({ ...VEH, carburantRembourse: true })).toBe(4000);
    expect(avantageNatureAnnuel({ ...VEH, plusDe5Ans: true, carburantRembourse: true })).toBe(3000);
  });
  it("électrique : abattement 70 % plafonné", () => {
    // 20 000 × 15 % = 3 000 ; abattement 70 % = 2 100 (< plafond) → 900.
    expect(avantageNatureAnnuel({ ...VEH, energie: "electrique" })).toBe(900);
    // Gros véhicule : abattement plafonné à 4 582 €/an.
    const gros = avantageNatureAnnuel({ ...VEH, energie: "electrique", valeurAchat: 60000 });
    expect(gros).toBe(60000 * 0.15 - AN_ELECTRIQUE_PLAFOND_ANNUEL);
  });
  it("valeur manquante / pas de véhicule → 0", () => {
    expect(avantageNatureAnnuel({ ...VEH, valeurAchat: 0 })).toBe(0);
    expect(avantageNatureAnnuel(null)).toBe(0);
  });
});

describe("salaires — 13e mois (½ juin, ½ décembre, prorata CDI)", () => {
  it("mois de versement : juin et décembre uniquement", () => {
    expect(isTreiziemeMonth("2026-06")).toBe(true);
    expect(isTreiziemeMonth("2026-12")).toBe(true);
    expect(isTreiziemeMonth("2026-07")).toBe(false);
  });
  it("CDI avant le semestre → moitié pleine", () => {
    expect(prorata13e("2024-03-15", "2026-06")).toBe(1);
    expect(prorata13e("2026-01-01", "2026-06")).toBe(1);
    expect(prorata13e("2026-07-01", "2026-12")).toBe(1);
  });
  it("CDI en cours de semestre → n mois de présence / 6 (mois d'entrée compté)", () => {
    expect(prorata13e("2026-04-01", "2026-06")).toBe(0.5);    // avr, mai, juin = 3/6
    expect(prorata13e("2026-06-15", "2026-06")).toBe(0.17);   // 1/6
    expect(prorata13e("2026-10-01", "2026-12")).toBe(0.5);    // oct→déc = 3/6
  });
  it("CDI après le semestre → 0 ; hors juin/déc ou sans date → null", () => {
    expect(prorata13e("2026-08-01", "2026-06")).toBe(0);
    expect(prorata13e("2026-03-01", "2026-07")).toBeNull();
    expect(prorata13e(null, "2026-06")).toBeNull();
  });
});

describe("salaires — éléments manquants (rappel avant transmission)", () => {
  it("heures incomplètes + supp sans décision signalées", () => {
    const m = missingElements("2026-07", null, null, {
      ...HEURES, weeksWithData: 3, suppSansDecisionMin: 90,
    });
    expect(m.some((x) => /3\/4 semaines/.test(x))).toBe(true);
    expect(m.some((x) => /sans décision/.test(x))).toBe(true);
  });
  it("13e mois à saisir en juin quand la fiche l'active, avec date CDI requise", () => {
    const m = missingElements("2026-06", { treizieme: true, cdiDate: null }, { primes: [], frais: [], updatedAt: "", updatedBy: "" }, HEURES);
    expect(m.some((x) => /13e mois/.test(x))).toBe(true);
    expect(m.some((x) => /CDI/.test(x))).toBe(true);
  });
  it("13e déjà saisi → plus de rappel ; véhicule sans valeur signalé", () => {
    const m = missingElements("2026-06",
      { treizieme: true, cdiDate: "2020-01-01", vehicule: { ...VEH, valeurAchat: 0 } },
      { primes: [{ id: "a", motif: "13e mois (½)", montant: 800, bulletinDe: "2026-06" }], frais: [], updatedAt: "", updatedBy: "" },
      HEURES);
    expect(m.some((x) => /13e mois à saisir/.test(x))).toBe(false);
    expect(m.some((x) => /Valeur d'achat/.test(x))).toBe(true);
  });
  it("dossier complet → aucun manque", () => {
    expect(missingElements("2026-07", { treizieme: false }, null, HEURES)).toEqual([]);
  });
});

describe("salaires — récap email au cabinet comptable", () => {
  it("contient le salarié, les heures, la prime et l'AN ; échappe le HTML", () => {
    const html = recapMailHtml("2026-07", [{
      name: "Maxyme MANDINE", email: "m@x.fr",
      heures: { ...HEURES, suppPayEquivMin: 206, ferieMin: 435, cpJours: 2 },
      anMensuel: 250, vehicule: VEH,
      primes: [{ id: "p", motif: "Prime <script>", montant: 150, bulletinDe: "2026-07" }],
      frais: [{ id: "f", motif: "Péages", montant: 42.5 }],
      missing: ["Heures supp sans décision"],
    }], "https://app");
    expect(html).toContain("Maxyme MANDINE");
    expect(html).toContain("151h40");
    expect(html).toContain("3h26");                    // supp payées (équiv.)
    expect(html).toContain("7h15");                    // férié
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain("<script>");
    expect(html).toContain("https://app/salaires");
    expect(html).toContain("⚠️");
  });
  it("libellé de mois lisible", () => {
    expect(salaireMonthLabel("2026-07")).toBe("juillet 2026");
  });
});
