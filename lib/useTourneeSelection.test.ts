import { describe, it, expect } from "vitest";
import { pickDefaultTournee, clientTourneeOptions, type TourneeOption, type CarrierOption, type SavedTournee } from "./useTourneeSelection";

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

describe("clientTourneeOptions — les tournées de la FICHE CLIENT (SERG_TRCL), rien d'autre", () => {
  const catalogue = [
    t(0, "NORD", "05:00:00", "62"),
    t(1, "IDF", "10:30:00", "91"),
    t(2, "SUD", "22:00:00"),
  ];

  it("une seule ligne fiche (Auchan Cambrai : ANTOINE × NORD) → une seule option, pré-sélectionnée", () => {
    const c = carrier({ tour: "NORD", tournees: [{ nom: "NORD", heure: "10:30:00" }] });
    const opts = clientTourneeOptions(catalogue, c);
    expect(opts.map((x) => x.nom)).toEqual(["NORD"]);
    // heure de la FICHE (ENLEVT) prioritaire sur celle du catalogue.
    expect(opts[0].heure).toBe("10:30:00");
    // lineId/désignation repris du catalogue quand le nom matche.
    expect(opts[0].lineId).toBe(0);
    expect(opts[0].des).toBe("62");
    // …et la tournée unique est pré-sélectionnée d'office.
    expect(pickDefaultTournee(opts, c, null)).toBe("0");
  });

  it("plusieurs tournées fiche → seules celles-ci, dans l'ordre de la fiche (défaut en tête)", () => {
    const c = carrier({ tournees: [{ nom: "SUD", heure: null }, { nom: "NORD", heure: null }] });
    const opts = clientTourneeOptions(catalogue, c);
    expect(opts.map((x) => x.nom)).toEqual(["SUD", "NORD"]);
  });

  it("tournée fiche ABSENTE du catalogue → proposée quand même (option synthétique)", () => {
    const c = carrier({ tournees: [{ nom: "TOURNEE SPECIALE", heure: "04:00:00" }] });
    const opts = clientTourneeOptions(catalogue, c);
    expect(opts).toHaveLength(1);
    expect(opts[0].nom).toBe("TOURNEE SPECIALE");
    expect(opts[0].heure).toBe("04:00:00");
    expect(opts[0].lineId).toBeLessThan(0);   // synthétique → lineId neutralisé au POST
  });

  it("fiche sans tournée (ou source historique) → catalogue complet (repli)", () => {
    expect(clientTourneeOptions(catalogue, carrier())).toHaveLength(3);
    expect(clientTourneeOptions(catalogue, carrier({ tournees: [] }))).toHaveLength(3);
    expect(clientTourneeOptions(catalogue, null)).toHaveLength(3);
  });

  it("match nom insensible à la casse/espaces ; heure du catalogue conservée si la fiche n'en a pas", () => {
    const c = carrier({ tournees: [{ nom: " nord ", heure: null }] });
    const opts = clientTourneeOptions(catalogue, c);
    expect(opts[0].lineId).toBe(0);
    expect(opts[0].heure).toBe("05:00:00");
  });
});
