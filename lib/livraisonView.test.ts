import { describe, it, expect } from "vitest";
import {
  docStatus,
  computeStatusCounts,
  computeView,
  docTourneeKeyLabel,
  filterBySegment,
  computeSegmentCounts,
  keepDeliverableClients,
  isDeliverableSegment,
  type Doc,
  type Carrier,
  type Tournee,
} from "./livraisonView";

/** Doc minimal — seuls les champs utiles aux calculs sont surchargés.
 *  `misEnPrep: true` par défaut : le doc de référence est « mis en préparation »
 *  (le flux Ventes → À préparer est testé explicitement plus bas). */
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
    misEnPrep: true,
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
    expect(computeStatusCounts(carriers)).toEqual({ ventes: 0, aPreparer: 1, fait: 1, depart: 1 });
  });

  it("un BL pas encore mis en préparation compte dans « Ventes », pas dans les états", () => {
    const carriers = [
      carrier([
        doc({ docEntry: 1, misEnPrep: false }),                      // vente en attente
        doc({ docEntry: 2, misEnPrep: undefined }),                  // absent = pas mis en prep
        doc({ docEntry: 3 }),                                        // mis en prep → à préparer
        doc({ docEntry: 4, misEnPrep: false, excluded: true }),      // exclu → non compté
      ]),
    ];
    expect(computeStatusCounts(carriers)).toEqual({ ventes: 2, aPreparer: 1, fait: 0, depart: 0 });
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

  it("onglet VENTES : les BL pas mis en préparation, quel que soit leur état", () => {
    const carriersV = [
      carrier([
        doc({ docEntry: 1, colis: 10, totalHT: 100, cardCode: "A", misEnPrep: false }),                 // vente en attente
        doc({ docEntry: 2, colis: 5, totalHT: 50, cardCode: "B", misEnPrep: false, prepared: true }),   // (état ignoré tant que pas lâché)
        doc({ docEntry: 3, colis: 2, totalHT: 20, cardCode: "A" }),                                     // mis en prep → hors Ventes
      ]),
    ];
    const v = computeView({ carriers: carriersV }, "VENTES");
    expect(v.carriers[0].docs.map((d) => d.docEntry)).toEqual([1, 2]);
    // weightKg = 25 + 25 (valeur par défaut du helper doc, non surchargée ici).
    expect(v.totals).toEqual({ orders: 2, clients: 2, colis: 15, weightKg: 50, totalHT: 150 });
    // …et un BL pas mis en préparation n'apparaît dans AUCUN onglet d'état.
    const ap = computeView({ carriers: carriersV }, "A_PREPARER");
    expect(ap.carriers[0].docs.map((d) => d.docEntry)).toEqual([3]);
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

describe("livraisonView — keepDeliverableClients (GMS / CHR / EXPORT uniquement)", () => {
  it("isDeliverableSegment ne reconnaît que les 3 segments livrés", () => {
    expect(isDeliverableSegment("GMS")).toBe(true);
    expect(isDeliverableSegment("CHR")).toBe(true);
    expect(isDeliverableSegment("EXPORT")).toBe(true);
    expect(isDeliverableSegment(null)).toBe(false);
    expect(isDeliverableSegment("RUNGIS")).toBe(false);
    expect(isDeliverableSegment("")).toBe(false);
  });

  it("retire les clients sans segment et les transporteurs qui en deviennent vides", () => {
    const carriers = [
      carrier([
        doc({ docEntry: 1, clientType: "GMS" }),
        doc({ docEntry: 2, clientType: null }),     // retrait / MIN / divers → exclu
        doc({ docEntry: 3, clientType: "CHR", excluded: true }), // exclu (avoir) mais livrable → gardé
      ]),
      carrier(
        [doc({ docEntry: 4, clientType: null }), doc({ docEntry: 5, clientType: "RUNGIS" })],
        { code: "DIRECT", name: "Direct" },         // aucun client livrable → transporteur retiré
      ),
    ];
    const kept = keepDeliverableClients(carriers);
    expect(kept).toHaveLength(1);
    expect(kept[0].docs.map((d) => d.docEntry)).toEqual([1, 3]);
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

  it("nom mémorisé FANTÔME (même transporteur) mais heure connue → résolu par heure", () => {
    // « IDF 1 » n'est pas dans le catalogue, mais l'heure mémorisée pointe « IDF ».
    const d = doc({ trspCode: "ANTOINE", savedTournee: { trspCode: "ANTOINE", heure: "05:00:00", nom: "IDF 1" } });
    expect(docTourneeKeyLabel(d, tournees)).toEqual({ key: "T:IDF", label: "IDF" });
  });

  it("nom mémorisé matché au catalogue, insensible à la casse", () => {
    const d = doc({ trspCode: "ANTOINE", savedTournee: { trspCode: "ANTOINE", heure: null, nom: "idf" } });
    expect(docTourneeKeyLabel(d, tournees)).toEqual({ key: "T:IDF", label: "IDF" });
  });

  it("bug Fontenay : tournée mémorisée d'un AUTRE transporteur ignorée → résolu par l'heure du BL", () => {
    // Le BL est passé en DIRECT/IDF (heure 00:00), mais la mémoire pointe encore
    // ANTOINE/IDF OUEST : on IGNORE la mémoire périmée et on résout par l'heure du
    // BL → « IDF » (comme le sélecteur), plus de faux sous-groupe « IDF OUEST ».
    const cat: Tournee[] = [
      { lineId: 10, nom: "IDF", des: "IDF", heure: "00:00:00" },
      { lineId: 11, nom: "IDF OUEST", des: "", heure: "02:00:00" },
    ];
    const d = doc({
      trspCode: "DIRECT", trspHeure: "00:00:00",
      savedTournee: { trspCode: "ANTOINE", heure: "14:00:00", nom: "IDF OUEST" },
    });
    expect(docTourneeKeyLabel(d, cat)).toEqual({ key: "T:IDF", label: "IDF" });
  });

  it("4) repli sur l'heure si catalogue muet", () => {
    const d = doc({ trspHeure: "07:15:00" });
    expect(docTourneeKeyLabel(d, tournees)).toEqual({ key: "H:07:15", label: "Tournée 07:15" });
  });

  it("5) « Sans tournée » en dernier recours", () => {
    expect(docTourneeKeyLabel(doc({}))).toEqual({ key: "T:__none__", label: "Sans tournée" });
  });
});
