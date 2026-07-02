import { describe, it, expect } from "vitest";
import { pickDefaultTournee, type TourneeOption, type CarrierOption, type SavedTournee } from "./useTourneeSelection";

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
});
