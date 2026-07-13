import { describe, it, expect } from "vitest";
import {
  lotFreshness, isExpiredLot, daysUntilDlc, compareFEFO, partitionByFreshness,
  type DatedLot,
} from "./lotFreshness";

const TODAY = new Date("2026-07-13T09:00:00Z");
const d = (iso: string) => new Date(iso + "T00:00:00Z");

describe("lotFreshness — classification par DLC", () => {
  it("périmé si la DLC est passée", () => {
    expect(lotFreshness(d("2026-07-10"), TODAY)).toBe("expired");
  });
  it("à écouler si la DLC est aujourd'hui ou dans la fenêtre d'alerte", () => {
    expect(lotFreshness(d("2026-07-13"), TODAY)).toBe("expiring"); // J+0
    expect(lotFreshness(d("2026-07-15"), TODAY)).toBe("expiring"); // J-2 (défaut 2 j)
  });
  it("frais au-delà de la fenêtre d'alerte", () => {
    expect(lotFreshness(d("2026-07-20"), TODAY)).toBe("fresh");
  });
  it("DLC non saisie ou illisible → unknown (pas de décision possible)", () => {
    expect(lotFreshness(null, TODAY)).toBe("unknown");
    expect(lotFreshness(new Date("invalid"), TODAY)).toBe("unknown");
  });
  it("daysUntilDlc compte des jours pleins, signe = périmé/restant", () => {
    expect(daysUntilDlc(d("2026-07-16"), TODAY)).toBe(3);
    expect(daysUntilDlc(d("2026-07-11"), TODAY)).toBe(-2);
  });
  it("isExpiredLot : vrai seulement si strictement dépassé", () => {
    expect(isExpiredLot(d("2026-07-12"), TODAY)).toBe(true);
    expect(isExpiredLot(d("2026-07-13"), TODAY)).toBe(false); // aujourd'hui = encore bon
    expect(isExpiredLot(null, TODAY)).toBe(false);            // inconnu ≠ périmé
  });
});

describe("compareFEFO — écouler la DLC la plus proche d'abord", () => {
  it("trie par DLC croissante (la plus proche = à écouler en premier)", () => {
    const lots: DatedLot[] = [
      { expirationDate: d("2026-07-20"), docNum: 3 },
      { expirationDate: d("2026-07-14"), docNum: 1 },
      { expirationDate: d("2026-07-17"), docNum: 2 },
    ];
    expect([...lots].sort(compareFEFO).map((l) => l.docNum)).toEqual([1, 2, 3]);
  });
  it("une DLC saisie passe AVANT une DLC inconnue", () => {
    const lots: DatedLot[] = [
      { expirationDate: null, docNum: 9 },
      { expirationDate: d("2026-07-30"), docNum: 5 },
    ];
    expect([...lots].sort(compareFEFO).map((l) => l.docNum)).toEqual([5, 9]);
  });
  it("sans DLC → repli FIFO (admission la plus ancienne, puis EM croissant)", () => {
    const lots: DatedLot[] = [
      { expirationDate: null, admissionDate: "2026-07-05", docNum: 30 },
      { expirationDate: null, admissionDate: "2026-07-02", docNum: 20 },
      { expirationDate: null, admissionDate: null, docNum: 10 }, // sans date → en dernier
    ];
    expect([...lots].sort(compareFEFO).map((l) => l.docNum)).toEqual([20, 30, 10]);
  });
});

describe("partitionByFreshness — les périmés ne sont JAMAIS proposables", () => {
  it("isole les lots périmés et trie les proposables FEFO", () => {
    const lots: DatedLot[] = [
      { expirationDate: d("2026-07-08"), docNum: 100 }, // périmé
      { expirationDate: d("2026-07-18"), docNum: 300 }, // frais
      { expirationDate: d("2026-07-14"), docNum: 200 }, // à écouler
    ];
    const { proposable, expired } = partitionByFreshness(lots, TODAY);
    expect(proposable.map((l) => l.docNum)).toEqual([200, 300]); // FEFO
    expect(expired.map((l) => l.docNum)).toEqual([100]);
  });
  it("liste vide → deux buckets vides (robuste)", () => {
    expect(partitionByFreshness([], TODAY)).toEqual({ proposable: [], expired: [] });
  });
});
