import { describe, it, expect } from "vitest";
import { isRealLot } from "./gervifrais-calc";

describe("isRealLot", () => {
  it("accepte un vrai lot EM<DocNum>", () => {
    expect(isRealLot("EM14878")).toBe(true);
    expect(isRealLot("em2700")).toBe(true);   // insensible à la casse
    expect(isRealLot(" EM99 ")).toBe(true);    // trim
  });

  it("rejette les sentinels d'attente et les vides", () => {
    expect(isRealLot("EM_PENDING")).toBe(false);
    expect(isRealLot("EM_FAM:fraise")).toBe(false);
    expect(isRealLot("")).toBe(false);
    expect(isRealLot(null)).toBe(false);
    expect(isRealLot(undefined)).toBe(false);
  });

  it("rejette ce qui n'est pas un EM numérique", () => {
    expect(isRealLot("EM")).toBe(false);        // pas de numéro
    expect(isRealLot("EM12A")).toBe(false);     // suffixe non numérique
    expect(isRealLot("LOT123")).toBe(false);
    expect(isRealLot("EM0000")).toBe(true);     // ancien défaut : reste un EM numérique
  });
});
