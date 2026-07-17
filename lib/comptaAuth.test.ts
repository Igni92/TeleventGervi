import { describe, it, expect } from "vitest";
import { hashComptaPassword, verifyComptaPassword } from "./comptaAuth";

describe("comptaAuth — mot de passe de l'accès comptable (scrypt)", () => {
  it("hash → vérifie le bon mot de passe, rejette le mauvais", () => {
    const stored = hashComptaPassword("Sup3r-M0t2Passe!");
    expect(stored.startsWith("scrypt$")).toBe(true);
    expect(verifyComptaPassword("Sup3r-M0t2Passe!", stored)).toBe(true);
    expect(verifyComptaPassword("mauvais", stored)).toBe(false);
  });

  it("deux hachages du même mot de passe diffèrent (sel aléatoire)", () => {
    expect(hashComptaPassword("abcdefghijkl")).not.toBe(hashComptaPassword("abcdefghijkl"));
  });

  it("valeurs vides / corrompues → refus, sans lever", () => {
    expect(verifyComptaPassword("", hashComptaPassword("abcdefghijkl"))).toBe(false);
    expect(verifyComptaPassword("x", null)).toBe(false);
    expect(verifyComptaPassword("x", "pasunformat")).toBe(false);
    expect(verifyComptaPassword("x", "scrypt$zz$nothex")).toBe(false);
  });
});
