import { describe, it, expect } from "vitest";
import { userInitials, docLabel, docRef } from "./docLabel";

describe("userInitials", () => {
  it("prend la 1re lettre des 2 premiers mots, en majuscules", () => {
    expect(userInitials("Maxyme MANDINE - Gervifrais")).toBe("MM");
    expect(userInitials("jean gervais")).toBe("JG");
  });
  it("retombe sur l'email puis « ?? » si vide", () => {
    expect(userInitials(null, "maxymemandine@gmail.com")).toBe("MG");
    expect(userInitials("", "")).toBe("??");
  });
});

describe("docRef — référence signée d'une pièce SAP", () => {
  const name = "Maxyme MANDINE";

  it("Commande d'achat : « CF <n°> - <initiales> à <heure> »", () => {
    expect(docRef({ prefix: "CF", docNum: 2709, name, heure: "13h10" })).toBe("CF 2709 - MM à 13h10");
  });

  it("Entrée marchandise : « EM <n°> - <initiales> à <heure> »", () => {
    expect(docRef({ prefix: "EM", docNum: 22350, name, heure: "14h30" })).toBe("EM 22350 - MM à 14h30");
  });

  it("Bon de livraison : « BL N°<n°> - <initiales> à <heure> » (numSign)", () => {
    expect(docRef({ prefix: "BL", docNum: 24015045, name, heure: "09h05", numSign: true }))
      .toBe("BL N°24015045 - MM à 09h05");
  });

  it("référence provisoire (n° pas encore attribué par SAP) : sans numéro", () => {
    expect(docRef({ prefix: "CF", name, heure: "13h10" })).toBe("CF - MM à 13h10");
  });

  it("sans heure : « CF <n°> - <initiales> »", () => {
    expect(docRef({ prefix: "EM", docNum: 22350, name })).toBe("EM 22350 - MM");
  });

  it("préserve une note (mention promo) en suffixe après « · »", () => {
    expect(docRef({ prefix: "BL", docNum: 24015045, name, heure: "09h05", numSign: true, note: "PROMO -10%" }))
      .toBe("BL N°24015045 - MM à 09h05 · PROMO -10%");
    expect(docRef({ prefix: "EM", docNum: 8, name, heure: "10h00", note: "réception CF 2709" }))
      .toBe("EM 8 - MM à 10h00 · réception CF 2709");
  });
});

describe("docLabel — ancien libellé (conservé pour les BL/offres par défaut)", () => {
  it("« <TYPE> - Televent : <initiales> »", () => {
    expect(docLabel("BL", "Maxyme MANDINE")).toBe("BL - Televent : MM");
  });
});
