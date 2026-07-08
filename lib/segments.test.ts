import { describe, it, expect } from "vitest";
import { isComptoirClient, segmentOfGroup } from "./segments";

describe("isComptoirClient", () => {
  it("false pour les 3 segments livrés (par code de groupe SAP)", () => {
    expect(segmentOfGroup(null, 118)).toBe("GMS");   // garde-fou : jeu de codes cohérent
    expect(isComptoirClient({ groupCode: 118 })).toBe(false); // GMS
    expect(isComptoirClient({ groupCode: 224 })).toBe(false); // CHR (METRO)
    expect(isComptoirClient({ groupCode: 205 })).toBe(false); // EXPORT
  });

  it("false quand le TYPE client signale un segment livré (repli sans groupe)", () => {
    expect(isComptoirClient({ type: "GMS" })).toBe(false);
    expect(isComptoirClient({ type: " export " })).toBe(false); // trim + casse
    expect(isComptoirClient({ type: "CHR", groupCode: null })).toBe(false);
  });

  it("true pour Rungis / MIN / divers (segments NON livrés)", () => {
    expect(isComptoirClient({ groupCode: 115 })).toBe(true);  // RUNGIS
    expect(isComptoirClient({ groupCode: 150 })).toBe(true);  // MIN RUNGIS
    expect(isComptoirClient({ groupCode: 9999 })).toBe(true); // groupe inconnu
  });

  it("true quand aucun signal de segment livré (vente comptoir par défaut)", () => {
    expect(isComptoirClient({})).toBe(true);
    expect(isComptoirClient({ type: null, groupCode: null, groupName: null })).toBe(true);
    expect(isComptoirClient({ type: "DIVERS" })).toBe(true);
  });

  it("le groupe SAP prime sur un type absent", () => {
    // Groupe CHR connu, type non renseigné → livré, pas comptoir.
    expect(isComptoirClient({ type: null, groupCode: 212 })).toBe(false); // POMONA (CHR)
  });
});
