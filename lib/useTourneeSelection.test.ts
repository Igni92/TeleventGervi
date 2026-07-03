import { describe, it, expect } from "vitest";
import { pickDefaultTournee, restrictToClientTournees, type TourneeOption, type CarrierOption, type SavedTournee } from "./useTourneeSelection";

/** Fabrique une option de tournée SERGTRS. */
const t = (lineId: number, nom: string, heure: string | null, des = ""): TourneeOption =>
  ({ lineId, nom, des, heure });

const carrier = (over: Partial<CarrierOption> = {}): CarrierOption => ({
  id: "c1", name: "Antoine", sapValue: "ANTOINE", ...over,
});

describe("pickDefaultTournee — pré-sélection de la tournée par défaut", () => {
  const tournees = [
    t(0, "NORD", "05:00:00", "62"),
    t(1, "IDF", "10:30:00", "91"),
    t(2, "SUD", "22:00:00"),
    t(3, "SANS HEURE", null),
  ];

  it("TRCL d'abord : match par heure (heureVueToBL → format SERGTRS)", () => {
    expect(pickDefaultTournee(tournees, carrier({ heure: "10:30:00" }), null)).toBe("1");
  });

  it("TRCL : match par nom (U_DistBy), insensible à la casse", () => {
    expect(pickDefaultTournee(tournees, carrier({ tour: "nord" }), null)).toBe("0");
  });

  it("TRCL : noms joints « A / B » — le premier qui matche gagne", () => {
    expect(pickDefaultTournee(tournees, carrier({ tour: "INCONNUE / SUD" }), null)).toBe("2");
  });

  it("TRCL prioritaire sur la mémoire (vérité métier d'abord)", () => {
    const saved: SavedTournee = { trspCode: "ANTOINE", heure: "22:00:00", nom: "SUD", lineId: 2 };
    expect(pickDefaultTournee(tournees, carrier({ heure: "05:00:00" }), saved)).toBe("0");
  });

  it("mémoire : par lineId d'abord", () => {
    const saved: SavedTournee = { trspCode: "ANTOINE", heure: null, lineId: 1 };
    expect(pickDefaultTournee(tournees, carrier(), saved)).toBe("1");
  });

  it("mémoire : par nom si le lineId ne matche plus", () => {
    const saved: SavedTournee = { trspCode: "ANTOINE", heure: null, nom: "sud", lineId: 999 };
    expect(pickDefaultTournee(tournees, carrier(), saved)).toBe("2");
  });

  it("mémoire : par heure en dernier recours", () => {
    const saved: SavedTournee = { trspCode: "ANTOINE", heure: "05:00:00" };
    expect(pickDefaultTournee(tournees, carrier(), saved)).toBe("0");
  });

  it("mémoire ignorée si elle vise un AUTRE transporteur", () => {
    const saved: SavedTournee = { trspCode: "ECOLISE", heure: "05:00:00", lineId: 0 };
    expect(pickDefaultTournee(tournees, carrier(), saved)).toBe("");
  });

  it("tournée unique horodatée → sélectionnée d'office", () => {
    expect(pickDefaultTournee([t(7, "UNIQUE", "06:00:00"), t(8, "OFF", null)], carrier(), null)).toBe("7");
  });

  it("aucun indice, plusieurs tournées → pas de pré-sélection (choix utilisateur)", () => {
    expect(pickDefaultTournee(tournees, carrier(), null)).toBe("");
  });

  it("les tournées SANS heure ne sont jamais pré-sélectionnées", () => {
    const saved: SavedTournee = { trspCode: "ANTOINE", heure: null, nom: "SANS HEURE", lineId: 3 };
    expect(pickDefaultTournee(tournees, carrier(), saved)).toBe("");
  });

  it("liste vide → \"\" (transporteur sans tournées)", () => {
    expect(pickDefaultTournee([], carrier({ heure: "05:00:00" }), null)).toBe("");
  });

  it("TRCL : le NOM prime sur l'heure (plusieurs tournées à la même heure)", () => {
    // Cas Auchan La Défense : IDF / IDF OUEST / IDF SUD partent toutes à 04:00 —
    // seule la tournée de la ligne 'O' (nom en tête de `tour`) doit gagner.
    const idf = [
      t(10, "IDF EST", "01:00:00"),
      t(11, "IDF OUEST", "04:00:00"),
      t(12, "IDF SUD", "04:00:00"),
      t(13, "IDF", "04:00:00"),
    ];
    const c = carrier({ sapValue: "DIRECT", tour: "IDF / IDF EST / IDF OUEST / IDF SUD", heure: "04:00:00" });
    expect(pickDefaultTournee(idf, c, null)).toBe("13");
  });

  it("TRCL : les noms sont essayés dans l'ORDRE (le premier existant gagne)", () => {
    const list = [t(0, "NORD", "05:00:00"), t(1, "SUD", "22:00:00")];
    expect(pickDefaultTournee(list, carrier({ tour: "SUD / NORD" }), null)).toBe("1");
  });
});

describe("restrictToClientTournees — catalogue restreint aux tournées du client (SERG_TRCL)", () => {
  const catalogue = [
    t(0, "NORD", "05:00:00"),
    t(1, "IDF", "10:30:00"),
    t(2, "SUD", "22:00:00"),
  ];

  it("une seule ligne TRCL (ex. Auchan Cambrai : ANTOINE → NORD) → une seule tournée proposée", () => {
    const kept = restrictToClientTournees(catalogue, carrier({ tour: "NORD" }));
    expect(kept.map((x) => x.nom)).toEqual(["NORD"]);
    // …et la tournée unique est pré-sélectionnée d'office.
    expect(pickDefaultTournee(kept, carrier({ tour: "NORD" }), null)).toBe("0");
  });

  it("plusieurs tournées TRCL → seules celles-ci sont proposées", () => {
    const kept = restrictToClientTournees(catalogue, carrier({ tour: "NORD / SUD" }));
    expect(kept.map((x) => x.nom)).toEqual(["NORD", "SUD"]);
  });

  it("sans info TRCL (tour vide/absent) → catalogue complet", () => {
    expect(restrictToClientTournees(catalogue, carrier())).toHaveLength(3);
    expect(restrictToClientTournees(catalogue, null)).toHaveLength(3);
  });

  it("aucun nom TRCL ne matche le catalogue → catalogue complet (sécurité)", () => {
    expect(restrictToClientTournees(catalogue, carrier({ tour: "INCONNUE" }))).toHaveLength(3);
  });

  it("insensible à la casse et aux espaces", () => {
    const kept = restrictToClientTournees(catalogue, carrier({ tour: " nord " }));
    expect(kept.map((x) => x.nom)).toEqual(["NORD"]);
  });
});
