import { describe, it, expect } from "vitest";
import { buildLotCandidates, type CandidateInputs } from "./lotCandidates";
import { chooseLot } from "./gervifrais-calc";
import { resolveLotForSegment, type LotMaps } from "./lotResolver";
import { partitionByFreshness, lotFreshness, type DatedLot } from "./lotFreshness";

/**
 * ════════════════════════════════════════════════════════════════════════
 *  SMOKE TEST D'AUDIT — « affectation / proposition de lot qui date énormément »
 * ════════════════════════════════════════════════════════════════════════
 *
 * Reproduit, sur la logique PURE et testable, les causes racines remontées par
 * l'opérateur. Chaque bloc `BUG` fige le comportement DÉFECTUEUX actuel (pour ne
 * pas régresser en le corrigeant), et le bloc `FIX` prouve que la primitive de
 * fraîcheur (lib/lotFreshness) résout le symptôme.
 *
 * Règles métier de référence : PRODUCT.md « Do » #4 (FIFO/FEFO réel + DLC),
 * audit métier 08-expert-metier §3 (rotation inversée) & priorité 3.
 */

const TODAY = new Date("2026-07-13T09:00:00Z");
const d = (iso: string) => new Date(iso + "T00:00:00Z");

// Petit builder d'entrées buildLotCandidates (repris de lotCandidates.test.ts).
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

function emptyMaps(): LotMaps {
  return {
    byItemWhs: new Map(), byItem: new Map(), byItemWarehouse: new Map(),
    byItemWhsList: new Map(), byItemList: new Map(), whsOfItemDoc: new Map(),
    docMeta: new Map(),
  };
}

describe("CAUSE #1 — chooseLot n'a AUCUNE conscience du lot ni de la DLC (garde-fou stock au niveau ARTICLE)", () => {
  it("BUG : pose un vieux lot résolu tant que l'ARTICLE a du stock — même si CE lot est épuisé/périmé", () => {
    // EM22762 = vieux lot résolu (dernière EM du segment, potentiellement vidée).
    // localAvailable = stock AGRÉGÉ de l'article (autres lots) → chooseLot valide.
    const choice = chooseLot({ resolvedLot: "EM22762", localAvailable: 480 });
    // Comportement actuel : le vieux lot part sur le BL, sans vérifier SON stock ni SA DLC.
    expect(choice).toEqual({ lot: "EM22762", reason: "fifo" });
    // ⇒ « affectation qui date » : rien ici ne peut écarter un lot périmé.
  });

  it("la donnée pour trancher EXISTE pourtant (la DLC classe bien le lot comme périmé)", () => {
    // Même lot, DLC dépassée : l'app SAIT déjà l'afficher en rouge (lotDlc.freshnessLabel)
    // mais ne s'en sert pas pour la SÉLECTION. Le correctif ne crée pas de donnée, il la BRANCHE.
    expect(lotFreshness(d("2026-07-08"), TODAY)).toBe("expired");
  });
});

describe("CAUSE #2 — resolveLotForSegment fige un vieux lot de segment (priorité affectation > fraîcheur)", () => {
  it("BUG : un client EXPORT reçoit SON vieux lot affecté, jamais le stock commun plus frais", () => {
    const m = emptyMaps();
    // Historique FRAISE|01 : EM300 (EXPORT, ancienne) puis EM320 (Tous, plus récente/fraîche).
    m.byItemWhsList.set("FRAISE|01", [320, 300]);
    m.byItemList.set("FRAISE", [320, 300]);
    m.whsOfItemDoc.set("FRAISE|300", "01");
    const affects = new Map<number, string>([[300, "EXPORT"]]);
    const r = resolveLotForSegment(m, affects, "FRAISE", "01", "EXPORT");
    // On prend l'EM EXPORT (300) même si 320 « Tous » est plus récente : c'est la règle
    // segment — mais rien ne vérifie que 300 est encore FRAÎCHE / EN STOCK.
    expect(r.lot).toBe("EM300");
  });
});

describe("CAUSE #3 — le route candidates propose de VIEUX lots sans filtre DLC (« proposition qui date »)", () => {
  it("BUG : buildLotCandidates liste un lot périmé exactement comme un frais (aucune entrée DLC)", () => {
    // Deux lots en stock : EM100 (vieux, entrepôt 01) et EM300 (récent, entrepôt R1).
    const r = buildLotCandidates(makeInputs({
      ems: [{ dn: 300, whs: "R1", date: "2026-07-12" }, { dn: 100, whs: "01", date: "2026-06-20" }],
      stockByWhs: { "01": 40, R1: 40 },
    }));
    // buildLotCandidates n'a PAS de paramètre DLC : il propose les DEUX, et rien
    // n'empêche EM100 (périmé) d'être choisi/affecté par l'opérateur.
    expect(r.candidates.map((c) => c.lot).sort()).toEqual(["EM100", "EM300"]);
  });

  it("FIX : partitionByFreshness écarte le lot périmé et ordonne le reste FEFO", () => {
    // La même liste, enrichie de la DLC (LotDlc) : EM100 est périmé, EM300 est frais.
    const dlc: Record<string, Date | null> = {
      EM100: d("2026-07-09"), // périmé
      EM300: d("2026-07-16"), // frais
    };
    const candidates: (DatedLot & { lot: string })[] = [
      { lot: "EM300", docNum: 300, expirationDate: dlc.EM300, admissionDate: "2026-07-12" },
      { lot: "EM100", docNum: 100, expirationDate: dlc.EM100, admissionDate: "2026-06-20" },
    ];
    const { proposable, expired } = partitionByFreshness(candidates, TODAY);
    expect(proposable.map((c) => c.lot)).toEqual(["EM300"]); // le périmé n'est plus proposé
    expect(expired.map((c) => c.lot)).toEqual(["EM100"]);    // isolé « à écouler / casse »
  });

  it("FIX : à DLC connue, l'ordre devient FEFO (le plus proche à écouler d'abord), pas FIFO admission", () => {
    const candidates: (DatedLot & { lot: string })[] = [
      { lot: "EM300", docNum: 300, expirationDate: d("2026-07-18"), admissionDate: "2026-07-12" },
      { lot: "EM250", docNum: 250, expirationDate: d("2026-07-15"), admissionDate: "2026-07-11" },
    ];
    const { proposable } = partitionByFreshness(candidates, TODAY);
    // EM250 expire plus tôt → à écouler AVANT EM300, même s'il est arrivé après.
    expect(proposable.map((c) => c.lot)).toEqual(["EM250", "EM300"]);
  });
});

describe("GARDE-FOU — le correctif ne casse pas le cas « aucune DLC saisie » (repli FIFO)", () => {
  it("sans aucune DLC, l'ordre reste FIFO admission (comportement historique préservé)", () => {
    const candidates: (DatedLot & { lot: string })[] = [
      { lot: "EM300", docNum: 300, expirationDate: null, admissionDate: "2026-07-12" },
      { lot: "EM100", docNum: 100, expirationDate: null, admissionDate: "2026-06-20" },
    ];
    const { proposable, expired } = partitionByFreshness(candidates, TODAY);
    expect(expired).toEqual([]);                              // rien n'est écarté à tort
    expect(proposable.map((c) => c.lot)).toEqual(["EM100", "EM300"]); // FIFO : plus ancien d'abord
  });
});
