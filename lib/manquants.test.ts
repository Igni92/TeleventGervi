import { describe, it, expect } from "vitest";
import { allocate, buildShortages, reorderPriority, type OrderNeed } from "./manquants";
import type { Carrier, Doc, Line } from "./livraisonView";

/* ── Fixtures ──────────────────────────────────────────────────────────── */

function line(over: Partial<Line> & { itemCode: string }): Line {
  return {
    itemName: over.itemCode,
    quantity: 0,
    colis: 0,
    weightKg: 0,
    warehouse: null,
    ...over,
  };
}

function doc(over: Partial<Doc> & { docEntry: number; lines: Line[] }): Doc {
  return {
    docNum: 1000 + over.docEntry,
    docDate: "2026-06-16",
    dueDate: "2026-06-17",
    takenAt: null,
    cardCode: `C${over.docEntry}`,
    cardName: `Client ${over.docEntry}`,
    totalHT: 0,
    totalTTC: 0,
    colis: 0,
    weightKg: 0,
    open: true,
    comments: "",
    numAtCard: "",
    trspCode: null,
    trspHeure: null,
    savedTournee: null,
    carrierName: null,
    clientType: "GMS",
    prepared: false,
    misEnPrep: true,
    excluded: false,
    lineCount: over.lines.length,
    ...over,
  };
}

function carrier(docs: Doc[]): Carrier {
  return { code: null, name: "—", orders: docs.length, colis: 0, weightKg: 0, totalHT: 0, docs };
}

const need = (over: Partial<OrderNeed> & { docEntry: number; qty: number }): OrderNeed => ({
  docNum: 1000 + over.docEntry,
  cardName: `Client ${over.docEntry}`,
  cardCode: `C${over.docEntry}`,
  carrierName: null,
  clientType: null,
  takenAt: null,
  colis: 0,
  ...over,
});

/* ── allocate ──────────────────────────────────────────────────────────── */

describe("manquants — allocate (glouton, sert dans l'ordre)", () => {
  it("sert les premières commandes puis passe le reliquat à acheter", () => {
    // Stock 10 ; demandes 6 + 5 + 3 = 14. On sert 6, puis 4/5, puis 0/3.
    const out = allocate(10, [need({ docEntry: 1, qty: 6 }), need({ docEntry: 2, qty: 5 }), need({ docEntry: 3, qty: 3 })]);
    expect(out.map((o) => o.served)).toEqual([6, 4, 0]);
    expect(out.map((o) => o.toBuy)).toEqual([0, 1, 3]);
  });

  it("stock suffisant → tout servi, rien à acheter", () => {
    const out = allocate(20, [need({ docEntry: 1, qty: 6 }), need({ docEntry: 2, qty: 5 })]);
    expect(out.every((o) => o.toBuy === 0)).toBe(true);
    expect(out.map((o) => o.served)).toEqual([6, 5]);
  });

  it("stock nul ou négatif → tout à acheter", () => {
    expect(allocate(0, [need({ docEntry: 1, qty: 4 })])[0]).toMatchObject({ served: 0, toBuy: 4 });
    expect(allocate(-3, [need({ docEntry: 1, qty: 4 })])[0]).toMatchObject({ served: 0, toBuy: 4 });
  });

  it("gère les quantités fractionnaires (kg) sans résidu flottant", () => {
    const out = allocate(0.3, [need({ docEntry: 1, qty: 0.1 }), need({ docEntry: 2, qty: 0.1 }), need({ docEntry: 3, qty: 0.2 })]);
    expect(out.map((o) => o.served)).toEqual([0.1, 0.1, 0.1]);
    expect(out.map((o) => o.toBuy)).toEqual([0, 0, 0.1]);
  });
});

/* ── buildShortages ────────────────────────────────────────────────────── */

describe("manquants — buildShortages (vrai déficit vs stock détenu)", () => {
  const carriers = [
    carrier([
      doc({ docEntry: 1, takenAt: "2026-06-16T08:00:00", lines: [line({ itemCode: "ABRI", itemName: "Abricot", quantity: 30, colis: 3 })] }),
      doc({ docEntry: 2, takenAt: "2026-06-16T09:00:00", lines: [line({ itemCode: "ABRI", itemName: "Abricot", quantity: 20, colis: 2 })] }),
    ]),
  ];

  it("il ne manque QUE le déficit réel (demande − stock), pas toute la demande", () => {
    // Demande abricot = 50, stock détenu = 44 → à acheter = 6 (le « 6 abricots »).
    const [s] = buildShortages(carriers, { ABRI: 44 }, {});
    expect(s.itemCode).toBe("ABRI");
    expect(s.demand).toBe(50);
    expect(s.onHand).toBe(44);
    expect(s.toBuy).toBe(6);
  });

  it("un article couvert par le stock n'est PAS un manquant", () => {
    expect(buildShortages(carriers, { ABRI: 60 }, {})).toEqual([]);
  });

  it("allocation par défaut : premier arrivé (heure de prise) servi d'abord", () => {
    const [s] = buildShortages(carriers, { ABRI: 44 }, {});
    // doc 1 (08:00) servi 30/30, doc 2 (09:00) servi 14/20 → 6 à acheter sur doc 2.
    expect(s.orders.map((o) => o.docEntry)).toEqual([1, 2]);
    expect(s.orders.map((o) => o.served)).toEqual([30, 14]);
    expect(s.orders.map((o) => o.toBuy)).toEqual([0, 6]);
  });

  it("priorité manuelle : la commande priorisée est servie complète, le reliquat bascule", () => {
    // On priorise doc 2 → il est servi 20/20 ; doc 1 prend le reliquat (24/30 → 6 à acheter).
    const [s] = buildShortages(carriers, { ABRI: 44 }, { ABRI: [2, 1] });
    expect(s.orders.map((o) => o.docEntry)).toEqual([2, 1]);
    expect(s.orders.map((o) => o.served)).toEqual([20, 24]);
    expect(s.orders.map((o) => o.toBuy)).toEqual([0, 6]);
  });

  it("ignore les BL exclus (avoir) et clôturés dans la demande", () => {
    const cs = [
      carrier([
        doc({ docEntry: 1, lines: [line({ itemCode: "ABRI", quantity: 30 })] }),
        doc({ docEntry: 2, excluded: true, lines: [line({ itemCode: "ABRI", quantity: 100 })] }),
        doc({ docEntry: 3, open: false, lines: [line({ itemCode: "ABRI", quantity: 100 })] }),
      ]),
    ];
    const [s] = buildShortages(cs, { ABRI: 20 }, {});
    expect(s.demand).toBe(30);   // 100 (avoir) + 100 (clôturé) ignorés
    expect(s.toBuy).toBe(10);
  });

  it("sans stock connu pour l'article → non jugé (pas de manquant)", () => {
    expect(buildShortages(carriers, {}, {})).toEqual([]);
    expect(buildShortages(carriers, undefined, {})).toEqual([]);
  });
});

/* ── reorderPriority ───────────────────────────────────────────────────── */

describe("manquants — reorderPriority", () => {
  it("monte / descend d'un cran", () => {
    expect(reorderPriority([1, 2, 3], 3, -1)).toEqual([1, 3, 2]);
    expect(reorderPriority([1, 2, 3], 1, 1)).toEqual([2, 1, 3]);
  });
  it("borne aux extrémités et ignore un docEntry absent", () => {
    expect(reorderPriority([1, 2, 3], 1, -1)).toEqual([1, 2, 3]);
    expect(reorderPriority([1, 2, 3], 3, 1)).toEqual([1, 2, 3]);
    expect(reorderPriority([1, 2, 3], 9, -1)).toEqual([1, 2, 3]);
  });
});
