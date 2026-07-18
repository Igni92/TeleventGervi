import { describe, it, expect } from "vitest";
import { isRealLot, planLedgerTrim } from "./gervifrais-calc";

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

describe("planLedgerTrim — écrêtage du registre au stock physique", () => {
  const lot = (batchNumber: string, quantity: number, admissionDate: string | null) =>
    ({ batchNumber, quantity, admissionDate });

  it("registre ≤ stock physique → aucun changement (jamais d'écriture à la hausse)", () => {
    expect(planLedgerTrim([lot("EM1", 100, "2026-07-01"), lot("EM2", 50, "2026-07-02")], 150)).toEqual([]);
    expect(planLedgerTrim([lot("EM1", 100, "2026-07-01")], 500)).toEqual([]);
    expect(planLedgerTrim([], 100)).toEqual([]);
  });

  it("stock physique nul → tous les lots à 0 (« pas de stock → pas de lot »)", () => {
    const lots = [lot("EM1", 100, "2026-07-01"), lot("EM2", 50, "2026-07-02")];
    const trims = planLedgerTrim(lots, 0);
    expect(trims.map((t) => [t.lot.batchNumber, t.quantity])).toEqual([["EM1", 0], ["EM2", 0]]);
    // Un stock négatif est traité comme nul.
    expect(planLedgerTrim([lot("EM1", 30, null)], -5)).toEqual([{ lot: lot("EM1", 30, null), quantity: 0 }]);
  });

  it("retire le surplus des lots les PLUS ANCIENS d'abord (FIFO), coupe partielle en frontière", () => {
    // Surplus 60 : EM1 (plus vieux) vidé (50), puis EM2 réduit de 10.
    const trims = planLedgerTrim(
      [lot("EM2", 80, "2026-07-05"), lot("EM1", 50, "2026-07-01"), lot("EM3", 40, "2026-07-09")],
      110,
    );
    expect(trims.map((t) => [t.lot.batchNumber, t.quantity])).toEqual([["EM1", 0], ["EM2", 70]]);
  });

  it("admission inconnue = réputé récent → écrêté en dernier", () => {
    const trims = planLedgerTrim(
      [lot("EM9", 40, null), lot("EM1", 30, "2026-07-01")],
      40,
    );
    expect(trims.map((t) => [t.lot.batchNumber, t.quantity])).toEqual([["EM1", 0]]);
  });

  it("égalité d'admission → départage par numéro de lot croissant", () => {
    const trims = planLedgerTrim(
      [lot("EM23160", 88, "2026-07-13"), lot("EM23159", 210, "2026-07-13")],
      200,
    );
    expect(trims.map((t) => [t.lot.batchNumber, t.quantity])).toEqual([["EM23159", 112]]);
  });

  it("cas réel Fraise FB4KA3B : registre 958 > stock 840 → surplus 118 retiré du plus ancien", () => {
    const lots = [
      lot("EM23159", 210, "2026-07-13"),
      lot("EM23160", 88, "2026-07-13"),
      lot("EM23162", 352, "2026-07-15"),
      lot("EM23171", 308, "2026-07-17"),
    ];
    const trims = planLedgerTrim(lots, 840);
    expect(trims.map((t) => [t.lot.batchNumber, t.quantity])).toEqual([["EM23159", 92]]);
    // Somme finale = stock physique.
    expect(92 + 88 + 352 + 308).toBe(840);
  });

  it("arrondit au millième (comme debitLots)", () => {
    const trims = planLedgerTrim([lot("EM1", 10.5, "2026-07-01"), lot("EM2", 5, "2026-07-02")], 12.345);
    expect(trims).toHaveLength(1);
    expect(trims[0].quantity).toBeCloseTo(7.345, 3);
  });
});
