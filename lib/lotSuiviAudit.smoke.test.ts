import { describe, it, expect } from "vitest";
import { buildLotCandidates, type CandidateInputs } from "./lotCandidates";
import { chooseLot } from "./gervifrais-calc";
import { resolveLotForSegment, type LotMaps } from "./lotResolver";

/**
 * ════════════════════════════════════════════════════════════════════════
 *  SMOKE TEST D'AUDIT — « affectation / proposition de lot qui date énormément »
 * ════════════════════════════════════════════════════════════════════════
 *
 * RÈGLE MÉTIER : on ne propose / n'affecte QUE les lots RÉELLEMENT PRÉSENTS EN
 * STOCK. Un lot épuisé (entrepôt sans stock) ne doit jamais remonter, même si un
 * registre garde un reliquat. La DLC n'entre PAS en compte.
 *
 * Chaque bloc `CAUSE` fige un comportement défectueux (garde-fou anti-régression),
 * `RÈGLE` prouve le comportement attendu (stock).
 */

const d = (iso: string) => iso; // dates ISO simples pour le tri FIFO

// Builder d'entrées buildLotCandidates (repris de lotCandidates.test.ts).
// `stockByWhs` = DISPO (= stock − réservé) en COLIS par entrepôt.
function makeInputs(opts: {
  segment?: string | null;
  ems: { dn: number; whs: string | null; affect?: string; date?: string }[];
  stockByWhs: Record<string, number>;
  suggestedLot?: string | null;
}): CandidateInputs {
  const emById = new Map(opts.ems.map((e) => [e.dn, e]));
  const total = Object.values(opts.stockByWhs).reduce((s, v) => s + v, 0);
  return {
    itemCode: "FRAISE",
    orderWarehouse: null,
    segment: opts.segment ?? null,
    emDocs: opts.ems.map((e) => e.dn).sort((a, b) => b - a),
    warehouseOf: (dn) => emById.get(dn)?.whs ?? null,
    affectOf: (dn) => emById.get(dn)?.affect ?? "TOUS",
    metaOf: (dn) => ({ date: emById.get(dn)?.date ?? null, supplier: null, label: `EM ${dn}` }),
    stockInWarehouse: (whs) => (whs ? (opts.stockByWhs[whs] ?? 0) : 0),
    itemTotalStock: total,
    suggestedLot: opts.suggestedLot ?? null,
  };
}
const lots = (r: { candidates: { lot: string }[] }) => r.candidates.map((c) => c.lot);

function emptyMaps(): LotMaps {
  return {
    byItemWhs: new Map(), byItem: new Map(), byItemWarehouse: new Map(),
    byItemWhsList: new Map(), byItemList: new Map(), whsOfItemDoc: new Map(),
    docMeta: new Map(),
  };
}

describe("CAUSE #1 — chooseLot ne regarde que le stock ARTICLE, jamais le lot", () => {
  it("pose un vieux lot résolu tant que l'ARTICLE a du stock — même si CE lot est épuisé", () => {
    // EM22762 = vieux lot résolu ; localAvailable = stock agrégé de l'article
    // (autres lots) → chooseLot valide sans vérifier le stock DE CE lot.
    expect(chooseLot({ resolvedLot: "EM22762", localAvailable: 480 }))
      .toEqual({ lot: "EM22762", reason: "fifo" });
    // ⇒ couvert en aval : garde-fou de départ (présence d'un lot) + proposition
    //   filtrée sur le stock (buildLotCandidates ci-dessous).
  });
});

describe("CAUSE #2 — resolveLotForSegment fige un vieux lot de segment", () => {
  it("un client EXPORT reçoit SON vieux lot affecté, sans vérifier qu'il est en stock", () => {
    const m = emptyMaps();
    m.byItemWhsList.set("FRAISE|01", [320, 300]); // 320 « Tous » (récent), 300 EXPORT (ancien)
    m.byItemList.set("FRAISE", [320, 300]);
    m.whsOfItemDoc.set("FRAISE|300", "01");
    const affects = new Map<number, string>([[300, "EXPORT"]]);
    expect(resolveLotForSegment(m, affects, "FRAISE", "01", "EXPORT").lot).toBe("EM300");
    // ⇒ rien ici ne vérifie le stock du lot 300 : d'où l'importance du filtre stock
    //   à la proposition et de la re-validation à la conversion.
  });
});

describe("RÈGLE — la proposition ne retient QUE les lots présents en stock", () => {
  it("écarte un lot dont l'entrepôt n'a AUCUN stock (le vieux lot épuisé ne remonte pas)", () => {
    const r = buildLotCandidates(makeInputs({
      ems: [
        { dn: 300, whs: "R1", date: d("2026-07-12") }, // R1 en stock → proposé
        { dn: 100, whs: "01", date: d("2026-06-20") }, // 01 vide → écarté (épuisé)
      ],
      stockByWhs: { R1: 40 }, // 01 absent = 0
    }));
    expect(lots(r)).toEqual(["EM300"]);   // le lot 100 « qui date » n'est PAS proposé
  });

  it("n'invente aucun lot quand l'article n'a de stock nulle part", () => {
    const r = buildLotCandidates(makeInputs({
      ems: [{ dn: 300, whs: "01" }, { dn: 100, whs: "R1" }],
      stockByWhs: {}, // rien en stock
    }));
    expect(r.candidates).toEqual([]);
    expect(r.suggested).toBeNull();
  });

  it("garde TOUS les lots en stock (un par entrepôt), n'écarte que les épuisés", () => {
    const r = buildLotCandidates(makeInputs({
      ems: [
        { dn: 300, whs: "01", date: d("2026-07-12") }, // en stock
        { dn: 250, whs: "R1", date: d("2026-07-08") }, // en stock
      ],
      stockByWhs: { "01": 20, R1: 20 },
    }));
    expect(lots(r).sort()).toEqual(["EM250", "EM300"]); // les deux présents en stock
  });

  it("n'affiche pas comme « suggéré » un lot épuisé (hors candidats en stock)", () => {
    const r = buildLotCandidates(makeInputs({
      ems: [{ dn: 300, whs: "01" }, { dn: 100, whs: "R1" }],
      stockByWhs: { R1: 30 }, // 01 vide → EM300 épuisé
      suggestedLot: "EM300",
    }));
    expect(lots(r)).toEqual(["EM100"]);
    expect(r.suggested).toBeNull();
  });
});
