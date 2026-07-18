import { describe, it, expect } from "vitest";
import {
  parseTariffMatrix,
  mergeExtraValues,
  matchCarrierCodes,
  type CellMatrix,
} from "./carrierTariffImport";
import { computePositionCost, type CarrierTariff } from "./carrierTariff";

/* Matrices répliquant les fichiers réels (colonnes A=0, B=1…), avec leurs
 * pièges : cellules parasites (Delanchy E6/D43…), e-mail contenant
 * « distribution » et section plateforme (Antoine). */

const DELANCHY: CellMatrix = [
  ["GERVIFRAIS TARIF 2025"],
  [],
  [],
  ["Dpt", "0 à 100kg", "101 à 500kg"],
  [16, 52.766080444964864, 429.064220356079],
  [17, 54.83481845688106, 438.82442020717076, null, 1.03],
  [18, 56.58528908234859, 462.21707311114614],
  [19, 56.58528908234859, 462.21707311114614],
  [36, 52.766080444964864, 429.064220356079],
  [90, 95.22240000000001, 761.9144, null, 1.04, 1.016],
  [],
  ["Frais administratif/envois ", null, 4.62],
  ["Majoration gasoil du mois en vigueur "],
  [],
  [null, null, null, 1.05],
];

const ANTOINE: CellMatrix = [
  [null, null, null, null, "Téléphone : 02 41 49 50 50\nMails exploitation :\nexploitation.cholet@antoinedistribution.fr\nregional@antoinedistribution.fr"],
  [],
  ["GERVIFRAIS", null, null, null, null, null, " 01 janvier 2026"],
  ["Condition de T° :", "Frais (+2°/+4°)"],
  [],
  ["Tarif au poids"],
  ["Palette formet EUR et 100 x 120"],
  [],
  ["1. Tarif plateforme"],
  [null, null, "Prix aux 100 kgs"],
  [null, null, "150 à 300 kgs ", "301 à 800 kgs", "801 à 1500 kgs"],
  ["Kuehne et Nagel CARVIN - 62", "mini 150 kg", 43.491943801418124, 36.816984024492676, 25.076907710959112],
  ["STEF SAINT OUEN - 95", "mini 150 kg", 28.440563912272516, 23.414711844940417, 19.247288860800005],
  [],
  ["2. Distribution"],
  [],
  ["Région Parisienne ", "Forfait", null, "Prix aux 100 kgs"],
  [null, "0-50", "51-100", "101-300", "301-800"],
  ["75 - 91 - 92 - 93 - 94", 37.856, 40.203072000000006, 34.021788385539274, 27.8372952389167],
  [],
  ["95 -78", 40.019200000000005, 42.214848, 35.722877804816235, 29.229160000862535],
  [],
  ["59-62- Hirson 02- Viry Noureuil 02 - Longuenesse St Omer -02", 43.264, 46.5088, 38.937599999999996, 31.9072],
  [],
  ["27-Bernay-60-76-80-02*", 42.1824, 44.031936, 36.481789344000006, 30.191825664000003, "*liste magasins étudiée ensemble et pour le 02 magasins remis à Frévial"],
  [],
  ["Frais Documentaire :", null, 3.05],
  [],
  ["Pied de facture GO : "],
  ["Indice : cuve moy. Mensuelle"],
  ["Base : 0,880 €/L"],
  ["Part 23%"],
  ["Pied de facture GNR :", "Indice de référence du Groupe Froid Autonome :", null, null, null, 283.84],
  [null, "Taux de pondération transport frais :", null, null, null, 0.026],
  ["Facturation Gestion des palettes : 1 € / palette "],
];

describe("parseTariffMatrix — Delanchy", () => {
  const res = parseTariffMatrix(DELANCHY);
  it("détecte le format et les cibles", () => {
    expect(res.format).toBe("delanchy");
    expect(res.carrierHints).toEqual(["DELANCHY", "FT86"]);
  });
  it("tranches 0–100 / 101–500 au forfait position", () => {
    expect(res.tariff.brackets).toEqual([
      { id: "0-100", minKg: 0, maxKg: 100, unit: "position" },
      { id: "101-500", minKg: 101, maxKg: 500, unit: "position" },
    ]);
  });
  it("regroupe les départements aux prix identiques, arrondis à 2 décimales", () => {
    const z16 = res.tariff.zones.find((z) => z.departements.includes("16"))!;
    expect(z16.departements).toEqual(["16", "36"]);          // mêmes prix → même zone
    expect(z16.prices).toEqual({ "0-100": 52.77, "101-500": 429.06 });
    const z18 = res.tariff.zones.find((z) => z.departements.includes("18"))!;
    expect(z18.departements).toEqual(["18", "19"]);
    expect(res.tariff.zones).toHaveLength(4);                // 16+36 · 17 · 18+19 · 90
  });
  it("lignes annexes : frais fixes lus, majoration gasoil en % (valeur au merge)", () => {
    expect(res.tariff.extras).toEqual([
      { id: "admin", label: "Frais administratifs / envoi", kind: "fixed", value: 4.62 },
      { id: "gazole", label: "Majoration gasoil (mois en vigueur)", kind: "percent", value: 0 },
    ]);
  });
});

describe("parseTariffMatrix — Antoine", () => {
  const res = parseTariffMatrix(ANTOINE);
  it("détecte le format malgré l'e-mail « antoinedistribution » et la plateforme", () => {
    expect(res.format).toBe("antoine");
    expect(res.carrierHints).toEqual(["ANTOINE"]);
  });
  it("tranches : forfaits 0–50 / 51–100, puis aux 100 kg", () => {
    expect(res.tariff.brackets.map((b) => [b.id, b.unit])).toEqual([
      ["0-50", "position"],
      ["51-100", "position"],
      ["101-300", "per100kg"],
      ["301-800", "per100kg"],
    ]);
  });
  it("zones : groupes de départements extraits des libellés (plateforme exclue)", () => {
    expect(res.tariff.zones).toHaveLength(4);
    expect(res.tariff.zones[0].departements).toEqual(["75", "91", "92", "93", "94"]);
    expect(res.tariff.zones[2].departements).toEqual(["59", "62", "02"]);
    expect(res.tariff.zones[3].departements).toEqual(["27", "60", "76", "80", "02"]);
    // Aucune zone ne provient de la section plateforme (62 de Carvin, 95 de St-Ouen).
    expect(res.tariff.zones[0].prices).toEqual({ "0-50": 37.86, "51-100": 40.2, "101-300": 34.02, "301-800": 27.84 });
  });
  it("lignes annexes : documentaire 3,05 € · palettes 1 € · GO/GNR en %", () => {
    expect(res.tariff.extras).toEqual([
      { id: "doc", label: "Frais documentaire", kind: "fixed", value: 3.05 },
      { id: "go", label: "Pied de facture GO (gazole, indexation cuve)", kind: "percent", value: 0 },
      { id: "gnr", label: "Pied de facture GNR (groupe froid, CNR)", kind: "percent", value: 0 },
      { id: "palette", label: "Gestion palettes (par palette)", kind: "fixed", value: 1 },
    ]);
  });
  it("grille exploitable : 200 kg en 92 → 34,02 € aux 100 kg", () => {
    const t: CarrierTariff = { ...res.tariff, carrierCode: "ANTOINE" };
    expect(computePositionCost(t, "92", 200)!.base).toBeCloseTo(68.04, 2);
  });
});

describe("mergeExtraValues", () => {
  const imported = parseTariffMatrix(DELANCHY).tariff.extras;
  it("valeur lue dans le fichier prioritaire, % repris de la grille existante", () => {
    const existing: CarrierTariff = {
      carrierCode: "DELANCHY",
      brackets: [], zones: [],
      extras: [{ id: "gazole", label: "Majoration", kind: "percent", value: 6.2 }],
    };
    const merged = mergeExtraValues(imported, existing, "DELANCHY");
    expect(merged.find((l) => l.id === "admin")!.value).toBe(4.62);   // lu dans le fichier
    expect(merged.find((l) => l.id === "gazole")!.value).toBe(6.2);   // conservé
  });
  it("sans grille existante : repli sur le modèle pré-rempli du transporteur", () => {
    const merged = mergeExtraValues(imported, null, "DELANCHY");
    expect(merged.find((l) => l.id === "gazole")!.value).toBe(5);     // template Delanchy
    const antoine = mergeExtraValues(parseTariffMatrix(ANTOINE).tariff.extras, null, "ANTOINE");
    expect(antoine.find((l) => l.id === "go")!.value).toBe(9.8);
    expect(antoine.find((l) => l.id === "gnr")!.value).toBe(3.4);
  });
  it("transporteur sans modèle : la valeur importée reste telle quelle", () => {
    const merged = mergeExtraValues(imported, null, "SCACHAP");
    expect(merged.find((l) => l.id === "gazole")!.value).toBe(0);
  });
});

describe("matchCarrierCodes", () => {
  it("matche les codes du catalogue contenant un repère", () => {
    expect(matchCarrierCodes(["DELANCHY", "FT86"], ["DELANCHY FT86", "SCACHAP", "Antoine"]))
      .toEqual({ codes: ["DELANCHY FT86"], matched: true });
    expect(matchCarrierCodes(["ANTOINE"], ["DELANCHY FT86", "antoine"]))
      .toEqual({ codes: ["ANTOINE"], matched: true });
  });
  it("repli sur les repères si aucun code ne matche", () => {
    expect(matchCarrierCodes(["ANTOINE"], ["SCACHAP"]))
      .toEqual({ codes: ["ANTOINE"], matched: false });
  });
});

describe("fichier inconnu", () => {
  it("lève une erreur explicite", () => {
    expect(() => parseTariffMatrix([["Tarif fruits"], ["pomme", 1.2]])).toThrow(/non reconnu/i);
  });
});
