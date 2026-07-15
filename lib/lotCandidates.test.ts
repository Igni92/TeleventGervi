import { describe, it, expect } from "vitest";
import { buildLotCandidates, type CandidateInputs } from "./lotCandidates";

/**
 * Smoke test complet de la construction des lots candidats (onglet « Bons de
 * commande »). Reproduit les défauts remontés par l'opérateur : trop de choix,
 * des lots « pas en stock », et vérifie la sélection/validation.
 */

// Fabrique un jeu d'entrées à partir d'EM décrites simplement, avec un stock
// article × entrepôt. `emDocs` est trié plus récent d'abord (comme lotResolver).
function makeInputs(opts: {
  itemCode?: string;
  orderWarehouse?: string | null;
  segment?: string | null;
  ems: { dn: number; whs: string | null; affect?: string; date?: string; supplier?: string }[];
  stockByWhs: Record<string, number>; // entrepôt → stock physique
  suggestedLot?: string | null;
  max?: number;
}): CandidateInputs {
  const itemCode = opts.itemCode ?? "FRAISE";
  const emById = new Map(opts.ems.map((e) => [e.dn, e]));
  const total = Object.values(opts.stockByWhs).reduce((s, v) => s + v, 0);
  return {
    itemCode,
    orderWarehouse: opts.orderWarehouse ?? null,
    segment: opts.segment ?? null,
    emDocs: opts.ems.map((e) => e.dn).sort((a, b) => b - a),
    warehouseOf: (dn) => emById.get(dn)?.whs ?? null,
    affectOf: (dn) => emById.get(dn)?.affect ?? "TOUS",
    metaOf: (dn) => ({ date: emById.get(dn)?.date ?? null, supplier: emById.get(dn)?.supplier ?? null, label: `EM ${dn}` }),
    stockInWarehouse: (whs) => (whs ? (opts.stockByWhs[whs] ?? 0) : 0),
    itemTotalStock: total,
    suggestedLot: opts.suggestedLot ?? null,
    max: opts.max,
  };
}

const lots = (r: { candidates: { lot: string }[] }) => r.candidates.map((c) => c.lot);

describe("buildLotCandidates — filtre stock (« pas en stock »)", () => {
  it("écarte les EM dont l'entrepôt n'a AUCUN stock physique", () => {
    const r = buildLotCandidates(makeInputs({
      ems: [
        { dn: 300, whs: "01" },   // 01 vide → écarté
        { dn: 200, whs: "R1" },   // R1 en stock → gardé
      ],
      stockByWhs: { R1: 40 },
    }));
    expect(lots(r)).toEqual(["EM200"]);
  });

  it("n'invente PAS un lot quand l'article n'a de stock nulle part", () => {
    const r = buildLotCandidates(makeInputs({
      ems: [{ dn: 300, whs: "01" }, { dn: 200, whs: "R1" }],
      stockByWhs: {}, // rien en stock
    }));
    expect(r.candidates).toEqual([]);
    expect(r.suggested).toBeNull();
  });

  it("écarte une EM sans entrepôt connu même si l'article a du stock ailleurs (fix « pas en stock »)", () => {
    // EM 300 sans entrepôt : l'ancien filtre la proposait (stock total > 0). Ici,
    // comme EM 200 (entrepôt vérifié en stock) existe, la 300 invérifiable est écartée.
    const r = buildLotCandidates(makeInputs({
      ems: [{ dn: 300, whs: null }, { dn: 200, whs: "01" }],
      stockByWhs: { "01": 25 },
    }));
    expect(lots(r)).toEqual(["EM200"]);
  });

  it("repli : aucune EM vérifiable mais stock total > 0 → propose UNE seule EM (la plus récente)", () => {
    const r = buildLotCandidates(makeInputs({
      ems: [{ dn: 300, whs: null }, { dn: 250, whs: null }, { dn: 100, whs: null }],
      stockByWhs: { "01": 12 }, // stock existe mais pas ventilé sur une EM connue
    }));
    expect(lots(r)).toEqual(["EM300"]);
    expect(r.candidates[0].qty).toBe(12); // qty = stock total de l'article
  });
});

describe("buildLotCandidates — dédup (« trop de choix »)", () => {
  it("ne garde qu'UNE EM par entrepôt (la plus récente) — FIFO", () => {
    const r = buildLotCandidates(makeInputs({
      ems: [
        { dn: 305, whs: "01" }, { dn: 304, whs: "01" }, { dn: 303, whs: "01" }, // même entrepôt → 1 seule
        { dn: 302, whs: "R1" },
      ],
      stockByWhs: { "01": 60, R1: 20 },
    }));
    expect(lots(r)).toEqual(["EM305", "EM302"]);
  });

  it("distingue les EM de segments différents dans le MÊME entrepôt (stock réservé ≠ stock commun)", () => {
    const r = buildLotCandidates(makeInputs({
      segment: null,
      ems: [
        { dn: 305, whs: "01", affect: "EXPORT" },
        { dn: 304, whs: "01", affect: "TOUS" },
        { dn: 303, whs: "01", affect: "TOUS" }, // écrasée par 304 (même entrepôt+segment)
      ],
      stockByWhs: { "01": 60 },
    }));
    expect(lots(r).sort()).toEqual(["EM304", "EM305"]);
  });

  it("réduit une longue histoire d'EM à une liste courte", () => {
    const ems = Array.from({ length: 12 }, (_, i) => ({ dn: 400 - i, whs: "01" }));
    const r = buildLotCandidates(makeInputs({ ems, stockByWhs: { "01": 100 } }));
    expect(r.candidates.length).toBe(1); // 12 EM du même entrepôt → 1 candidat
    expect(lots(r)).toEqual(["EM400"]);
  });

  it("respecte le plafond `max` en garde-fou", () => {
    const ems = [
      { dn: 500, whs: "A" }, { dn: 499, whs: "B" }, { dn: 498, whs: "C" },
      { dn: 497, whs: "D" }, { dn: 496, whs: "E" },
    ];
    const r = buildLotCandidates(makeInputs({
      ems,
      stockByWhs: { A: 1, B: 1, C: 1, D: 1, E: 1 },
      max: 3,
    }));
    expect(r.candidates.length).toBe(3);
  });
});

describe("buildLotCandidates — tri par pertinence (validation)", () => {
  it("met l'entrepôt de la ligne de commande en tête", () => {
    const r = buildLotCandidates(makeInputs({
      orderWarehouse: "R1",
      ems: [{ dn: 300, whs: "01" }, { dn: 200, whs: "R1" }],
      stockByWhs: { "01": 30, R1: 30 },
    }));
    expect(lots(r)[0]).toBe("EM200"); // R1 (entrepôt ligne) devant, malgré DocNum plus petit
  });

  it("priorise l'EM du SEGMENT du client, puis le stock commun (Tous)", () => {
    const r = buildLotCandidates(makeInputs({
      segment: "EXPORT",
      ems: [
        { dn: 300, whs: "01", affect: "TOUS" },
        { dn: 290, whs: "R1", affect: "EXPORT" },
        { dn: 280, whs: "Z9", affect: "GMS" },
      ],
      stockByWhs: { "01": 10, R1: 10, Z9: 10 },
    }));
    expect(lots(r)).toEqual(["EM290", "EM300", "EM280"]); // export → tous → gms
  });
});

describe("buildLotCandidates — suggestion", () => {
  it("conserve la suggestion si elle a du stock (survit au filtre)", () => {
    const r = buildLotCandidates(makeInputs({
      ems: [{ dn: 300, whs: "01" }, { dn: 200, whs: "R1" }],
      stockByWhs: { "01": 30, R1: 30 },
      suggestedLot: "EM300",
    }));
    expect(r.suggested).toBe("EM300");
  });

  it("annule la suggestion si son entrepôt est vide (ne suggère pas un lot « pas en stock »)", () => {
    const r = buildLotCandidates(makeInputs({
      ems: [{ dn: 300, whs: "01" }, { dn: 200, whs: "R1" }],
      stockByWhs: { R1: 30 }, // 01 vide → EM300 écartée
      suggestedLot: "EM300",
    }));
    expect(lots(r)).toEqual(["EM200"]);
    expect(r.suggested).toBeNull();
  });

  it("liste vide → suggestion nulle", () => {
    const r = buildLotCandidates(makeInputs({
      ems: [{ dn: 300, whs: "01" }],
      stockByWhs: {},
      suggestedLot: "EM300",
    }));
    expect(r.candidates).toEqual([]);
    expect(r.suggested).toBeNull();
  });
});

describe("buildLotCandidates — robustesse", () => {
  it("aucune EM → liste vide, pas d'erreur", () => {
    const r = buildLotCandidates(makeInputs({ ems: [], stockByWhs: { "01": 50 } }));
    expect(r.candidates).toEqual([]);
    expect(r.suggested).toBeNull();
  });

  it("porte les métadonnées d'affichage (date, fournisseur, affect normalisé, qty entrepôt)", () => {
    const r = buildLotCandidates(makeInputs({
      ems: [{ dn: 300, whs: "01", affect: "export", date: "2026-07-10", supplier: "Fournisseur X" }],
      stockByWhs: { "01": 42 },
    }));
    expect(r.candidates[0]).toMatchObject({
      lot: "EM300", docNum: 300, warehouse: "01",
      affect: "EXPORT", date: "2026-07-10", supplier: "Fournisseur X", qty: 42,
    });
  });
});
