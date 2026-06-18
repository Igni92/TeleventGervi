import { describe, it, expect } from "vitest";
import { suggestLevel, getLevel, isRelanceCode, RELANCE_LEVELS } from "./levels";

describe("suggestLevel — échelle R0→R5 (NT-2026-RC-01 §2)", () => {
  it("renvoie null tant que l'échéance est lointaine (< J-3)", () => {
    expect(suggestLevel(-10)).toBeNull();
    expect(suggestLevel(-4)).toBeNull();
  });

  it("franchit chaque palier au bon nombre de jours", () => {
    expect(suggestLevel(-3)).toBe("R0"); // J-3
    expect(suggestLevel(0)).toBe("R0");
    expect(suggestLevel(7)).toBe("R0");
    expect(suggestLevel(8)).toBe("R1"); // J+8
    expect(suggestLevel(20)).toBe("R1");
    expect(suggestLevel(21)).toBe("R2"); // J+21
    expect(suggestLevel(34)).toBe("R2");
    expect(suggestLevel(35)).toBe("R3"); // J+35
    expect(suggestLevel(44)).toBe("R3");
    expect(suggestLevel(45)).toBe("R4"); // J+45
    expect(suggestLevel(59)).toBe("R4");
    expect(suggestLevel(60)).toBe("R5"); // J+60
    expect(suggestLevel(200)).toBe("R5");
  });
});

describe("helpers de niveau", () => {
  it("getLevel renvoie le bon palier et lève sur code inconnu", () => {
    expect(getLevel("R4").libelle).toBe("Mise en demeure");
    // @ts-expect-error code invalide
    expect(() => getLevel("R9")).toThrow();
  });

  it("isRelanceCode valide les 6 codes", () => {
    for (const l of RELANCE_LEVELS) expect(isRelanceCode(l.code)).toBe(true);
    expect(isRelanceCode("R6")).toBe(false);
    expect(isRelanceCode(null)).toBe(false);
  });

  it("R2+ sont multi-factures, R0/R1 mono-facture ; décompte à partir de R3", () => {
    expect(getLevel("R0").multiInvoice).toBe(false);
    expect(getLevel("R1").multiInvoice).toBe(false);
    expect(getLevel("R2").multiInvoice).toBe(true);
    expect(getLevel("R2").showBreakdown).toBe(false);
    expect(getLevel("R3").showBreakdown).toBe(true);
    expect(getLevel("R4").showBreakdown).toBe(true);
  });
});
