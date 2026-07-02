import { describe, it, expect } from "vitest";
import {
  docStatus,
  computeStatusCounts,
  computeView,
  docTourneeKeyLabel,
  filterBySegment,
  computeSegmentCounts,
  type Doc,
  type Carrier,
  type Tournee,
} from "./livraisonView";

/** Doc minimal — seuls les champs utiles aux calculs sont surchargés. */
function doc(over: Partial<Doc>): Doc {
  return {
    docEntry: 1,
    docNum: 1001,
    docDate: "2026-06-16",
    dueDate: "2026-06-17",
    cardCode: "ACAL",
    cardName: "Client Test",
    totalHT: 100,
    totalTTC: 105.5,
    colis: 10,
    weightKg: 25,
    open: true,
    comments: "",
    numAtCard: "",
    trspCode: "ANTOINE",
    trspHeure: null,
    savedTournee: null,
    carrierName: "Antoine",
    clientType: "GMS",
    prepared: false,
    excluded: false,
    lineCount: 1,
    lines: [],
    ...over,
  };
}

function carrier(docs: Doc[], over: Partial<Carrier> = {}): Carrier {
  return { code: "ANTOINE", name: "Antoine", orders: docs.length, colis: 0, weightKg: 0, totalHT: 0, docs, ...over };
}

describe("livraisonView — docStatus (parti > préparé > à préparer)", () => {
  it("départ prime sur préparé", () => {
    expect(docStatus({ prepared: true, departed: true })).toBe("DEPART");
  });
  it("préparé sans départ → FAIT", () => {
    expect(docStatus({ prepared: true, departed: false })).toBe("FAIT");
  });
  it("ni préparé ni parti → À préparer", () => {
    expect(docStatus({ prepared: false })).toBe("A_PREPARER");
  });
});

describe("livraisonView — computeStatusCounts", () => {
  it("compte par état, sans les BL « avoir / exclu »", () => {
    const carriers = [
      carrier([
        doc({ docEntry: 1 }),                                        // à préparer
        doc({ docEntry: 2, prepared: true }),                        // fait
        doc({ docEntry: 3, prepared: true, departed: true }),        // départ
        doc({ docEntry: 4, excluded: true }),                        // exclu → non compté
      ]),
    ];
    expect(computeStatusCounts(carriers)).toEqual({ aPreparer: 1, fait: 1, depart: 1, manquants: 0 });
  });

  it("compte les commandes avec manquants (tous états, exclus compris)", () => {
    const carriers = [
      carrier([
        doc({ docEntry: 1, missingItems: ["A1"] }),                              // à préparer + manquant
        doc({ docEntry: 2, prepared: true, missingItems: ["B2", "C3"] }),        // fait + manquant
        doc({ docEntry: 3, prepared: true }),                                    // fait, sans manquant
        doc({ docEntry: 4, excluded: true, missingItems: ["D4"] }),              // exclu mais manquant à traiter
      ]),
    ];
    expect(computeStatusCounts(carriers)).toEqual({ aPreparer: 1, fait: 2, depart: 0, manquants: 3 });
  });
});

describe("livraisonView — computeView (exclusion des BL avoirés)", () => {
  const carriers = [
    carrier([
      doc({ docEntry: 1, colis: 10, weightKg: 25, totalHT: 100, cardCode: "A" }),
      doc({ docEntry: 2, colis: 4, weightKg: 8, totalHT: 50, cardCode: "B", excluded: true }),
      doc({ docEntry: 3, colis: 2, weightKg: 3, totalHT: 20, cardCode: "A", prepared: true }),
    ]),
  ];

  it("garde les BL exclus dans la liste mais les déduit des totaux", () => {
    const v = computeView({ carriers }, "A_PREPARER");
    // Les 2 BL « à préparer » (dont l'exclu) restent listés…
    expect(v.carriers[0].docs.map((d) => d.docEntry)).toEqual([1, 2]);
    expect(v.count).toBe(2);
    // …mais seuls les non-exclus comptent dans les métriques.
    expect(v.totals).toEqual({ orders: 1, clients: 1, colis: 10, weightKg: 25, totalHT: 100 });
    expect(v.carriers[0].orders).toBe(1);
    expect(v.carriers[0].colis).toBe(10);
    expect(v.carriers[0].totalHT).toBe(100);
  });

  it("filtre par onglet et compte les clients distincts", () => {
    const v = computeView({ carriers }, "FAIT");
    expect(v.carriers[0].docs.map((d) => d.docEntry)).toEqual([3]);
    expect(v.totals).toEqual({ orders: 1, clients: 1, colis: 2, weightKg: 3, totalHT: 20 });
  });

  it("retire les transporteurs sans commande dans l'onglet", () => {
    const v = computeView({ carriers }, "DEPART");
    expect(v.carriers).toEqual([]);
    expect(v.totals.orders).toBe(0);
  });

  it("onglet MANQUANTS : filtre tous états confondus sur la présence d'un manquant", () => {
    const carriersM = [
      carrier([
        doc({ docEntry: 1, colis: 10, totalHT: 100, cardCode: "A", missingItems: ["X"] }), // à préparer + manquant
        doc({ docEntry: 2, colis: 5, totalHT: 50, cardCode: "B", prepared: true, departed: true, missingItems: ["Y"] }), // parti + manquant
        doc({ docEntry: 3, colis: 2, totalHT: 20, cardCode: "A", prepared: true }),         // sans manquant → exclu de l'onglet
      ]),
    ];
    const v = computeView({ carriers: carriersM }, "MANQUANTS");
    expect(v.carriers[0].docs.map((d) => d.docEntry)).toEqual([1, 2]);
    // weightKg = 25 + 25 (valeur par défaut du helper doc, non surchargée ici).
    expect(v.totals).toEqual({ orders: 2, clients: 2, colis: 15, weightKg: 50, totalHT: 150 });
  });

  it("arrondit les sommes (0,1 colis/kg ; 0,01 €)", () => {
    const v = computeView(
      { carriers: [carrier([
        doc({ docEntry: 1, colis: 0.1, weightKg: 0.1, totalHT: 0.111, cardCode: "A" }),
        doc({ docEntry: 2, colis: 0.2, weightKg: 0.2, totalHT: 0.222, cardCode: "B" }),
      ])] },
      "A_PREPARER",
    );
    expect(v.totals.colis).toBe(0.3);
    expect(v.totals.weightKg).toBe(0.3);
    expect(v.totals.totalHT).toBe(0.33);
  });
});

describe("livraisonView — filtre segment (Tout / CHR / Export / GMS)", () => {
  const carriers = [
    carrier([
      doc({ docEntry: 1, clientType: "GMS" }),
      doc({ docEntry: 2, clientType: "CHR" }),
      doc({ docEntry: 3, clientType: null }),                              // client sans segment
    ]),
    carrier(
      [
        doc({ docEntry: 4, clientType: "EXPORT" }),
        doc({ docEntry: 5, clientType: "CHR", excluded: true }),           // exclu → listé mais non compté
      ],
      { code: "DELANCHY", name: "Delanchy" },
    ),
  ];

  it("TOUT ne filtre rien (clients sans segment inclus)", () => {
    expect(filterBySegment(carriers, "TOUT")).toBe(carriers);
  });

  it("filtre par segment et retire les transporteurs vides", () => {
    const chr = filterBySegment(carriers, "CHR");
    expect(chr.flatMap((c) => c.docs.map((d) => d.docEntry))).toEqual([2, 5]);
    const exp = filterBySegment(carriers, "EXPORT");
    expect(exp.map((c) => c.code)).toEqual(["DELANCHY"]);
    expect(exp[0].docs.map((d) => d.docEntry)).toEqual([4]);
    const gms = filterBySegment(carriers, "GMS");
    expect(gms.flatMap((c) => c.docs.map((d) => d.docEntry))).toEqual([1]);
  });

  it("compte par segment sans les BL exclus — TOUT inclut les sans-segment", () => {
    expect(computeSegmentCounts(carriers)).toEqual({ TOUT: 4, CHR: 1, EXPORT: 1, GMS: 1 });
  });
});

describe("livraisonView — docTourneeKeyLabel", () => {
  const tournees: Tournee[] = [
    { lineId: 1, nom: "IDF", des: "75", heure: "05:00:00" },
    { lineId: 2, nom: "NORD", des: "62", heure: "10:30:00" },
  ];

  it("1) nom mémorisé prioritaire", () => {
    const d = doc({ savedTournee: { trspCode: "ANTOINE", heure: null, nom: "Idf 2" } });
    expect(docTourneeKeyLabel(d, tournees)).toEqual({ key: "T:IDF 2", label: "Idf 2" });
  });

  it("2) résolution par LineId mémorisé dans le catalogue", () => {
    const d = doc({ savedTournee: { trspCode: "ANTOINE", heure: null, lineId: 2 } });
    expect(docTourneeKeyLabel(d, tournees)).toEqual({ key: "T:NORD", label: "NORD" });
  });

  it("3) résolution par heure du BL dans le catalogue", () => {
    const d = doc({ trspHeure: "05:00:00" });
    expect(docTourneeKeyLabel(d, tournees)).toEqual({ key: "T:IDF", label: "IDF" });
  });

  it("4) repli sur l'heure si catalogue muet", () => {
    const d = doc({ trspHeure: "07:15:00" });
    expect(docTourneeKeyLabel(d, tournees)).toEqual({ key: "H:07:15", label: "Tournée 07:15" });
  });

  it("5) « Sans tournée » en dernier recours", () => {
    expect(docTourneeKeyLabel(doc({}))).toEqual({ key: "T:__none__", label: "Sans tournée" });
  });
});
