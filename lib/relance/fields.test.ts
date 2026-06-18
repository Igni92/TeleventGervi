import { describe, it, expect } from "vitest";
import {
  formatEUR,
  formatDateFR,
  overdueDaysFor,
  computePenalty,
  buildRelanceContext,
  type RelanceInvoice,
} from "./fields";
import { DEFAULT_RELANCE_PARAMS } from "./params";

const inv = (over: Partial<RelanceInvoice>): RelanceInvoice => ({
  docEntry: 1,
  docNum: 457,
  docDate: new Date("2026-04-12T08:00:00Z"),
  dueDate: new Date("2026-05-12T08:00:00Z"),
  docTotal: 4820,
  balance: 4820,
  overdueDays: 23,
  ...over,
});

describe("formatEUR — typographie FR", () => {
  it("groupe les milliers et met la virgule décimale", () => {
    expect(formatEUR(4820)).toBe("4 820,00 €");
    expect(formatEUR(61.4)).toBe("61,40 €");
    expect(formatEUR(0)).toBe("0,00 €");
    expect(formatEUR(1234567.5)).toBe("1 234 567,50 €");
  });
});

describe("formatDateFR — fuseau Europe/Paris", () => {
  it("rend jj/mm/aaaa, — si absente", () => {
    expect(formatDateFR(new Date("2026-05-12T08:00:00Z"))).toBe("12/05/2026");
    expect(formatDateFR(null)).toBe("—");
  });
});

describe("overdueDaysFor — bornes de jour Paris", () => {
  it("compte les jours par rapport à l'échéance (négatif avant)", () => {
    const ref = new Date("2026-06-04T10:00:00Z"); // 23 j après le 12/05
    expect(overdueDaysFor(new Date("2026-05-12T00:00:00Z"), ref)).toBe(23);
    expect(overdueDaysFor(new Date("2026-06-07T00:00:00Z"), ref)).toBe(-3); // J-3
    expect(overdueDaysFor(null, ref)).toBe(0);
  });
});

describe("computePenalty", () => {
  it("vaut 0 si le taux n'est pas paramétré (on n'invente pas de montant)", () => {
    expect(computePenalty(4820, 23, 0)).toBe(0);
  });
  it("applique principal × taux annuel × jours/365", () => {
    // 4820 × 0,1505 × 23/365 ≈ 45,71
    expect(computePenalty(4820, 23, 0.1505)).toBeCloseTo(45.71, 2);
  });
  it("vaut 0 avant l'échéance", () => {
    expect(computePenalty(4820, -3, 0.15)).toBe(0);
  });
});

describe("buildRelanceContext", () => {
  it("IFR = 40 € PAR facture (et non une fois par client) — §7", () => {
    const ctx = buildRelanceContext({
      client: { cardCode: "C1", raisonSociale: "SARL LES DÉLICES" },
      invoices: [inv({ docEntry: 1, balance: 1000 }), inv({ docEntry: 2, balance: 2000 })],
      params: DEFAULT_RELANCE_PARAMS,
    });
    expect(ctx.totals.nbFactures).toBe(2);
    expect(ctx.totals.ifr).toBe(80); // 40 × 2
    expect(ctx.totals.principal).toBe(3000);
    expect(ctx.fields.IndemniteForfaitaire).toBe("80,00 €");
    expect(ctx.fields.MontantRestantDu).toBe("3 000,00 €");
  });

  it("total dû = principal + pénalités + IFR ; pénalités 0 par défaut", () => {
    const ctx = buildRelanceContext({
      client: { cardCode: "C1", raisonSociale: "SARL LES DÉLICES" },
      invoices: [inv({ balance: 4820, overdueDays: 23 })],
      params: DEFAULT_RELANCE_PARAMS,
    });
    expect(ctx.totals.penalites).toBe(0);
    expect(ctx.totals.total).toBe(4860); // 4820 + 0 + 40
    expect(ctx.fields.TotalDu).toBe("4 860,00 €");
  });

  it("calcule les pénalités quand un taux est paramétré", () => {
    const ctx = buildRelanceContext({
      client: { cardCode: "C1", raisonSociale: "X" },
      invoices: [inv({ balance: 4820, overdueDays: 23 })],
      params: { ...DEFAULT_RELANCE_PARAMS, penaliteTauxAnnuel: 0.1505 },
    });
    expect(ctx.totals.penalites).toBeCloseTo(45.71, 2);
    expect(ctx.totals.total).toBeCloseTo(4820 + 45.71 + 40, 2);
  });

  it("retient la facture la plus en retard comme référence (R0/R1)", () => {
    const ctx = buildRelanceContext({
      client: { cardCode: "C1", raisonSociale: "X" },
      invoices: [
        inv({ docEntry: 1, docNum: 100, overdueDays: 8 }),
        inv({ docEntry: 2, docNum: 200, overdueDays: 40 }),
      ],
      params: DEFAULT_RELANCE_PARAMS,
    });
    expect(ctx.primary.docNum).toBe(200);
    expect(ctx.fields.NumFacture).toBe("200");
    expect(ctx.fields.JoursRetard).toBe("40");
  });

  it("civilité par défaut + repli DocEntry si DocNum absent", () => {
    const ctx = buildRelanceContext({
      client: { cardCode: "C1", raisonSociale: "X" },
      invoices: [inv({ docEntry: 77, docNum: null })],
      params: DEFAULT_RELANCE_PARAMS,
    });
    expect(ctx.fields.Civilite).toBe("Madame, Monsieur");
    expect(ctx.fields.NumFacture).toBe("77");
  });

  it("soustrait les encaissements non affectés : net = solde compte tiers (grand livre)", () => {
    // Cas FANTASY : factures 170 413,91 − encaissé 85 425,48 = SOLDE 84 988,43.
    const ctx = buildRelanceContext({
      client: { cardCode: "FANTASY", raisonSociale: "FANTASY PVT." },
      invoices: [
        inv({ docEntry: 1, balance: 100000, overdueDays: 40 }),
        inv({ docEntry: 2, balance: 70413.91, overdueDays: 30 }),
      ],
      params: DEFAULT_RELANCE_PARAMS,
      currentAccountBalance: 84988.43,
    });
    expect(ctx.totals.openTotal).toBeCloseTo(170413.91, 2);
    expect(ctx.totals.principal).toBeCloseTo(84988.43, 2); // net
    expect(ctx.totals.encaissementsNonAffectes).toBeCloseTo(85425.48, 2);
    expect(ctx.totals.total).toBeCloseTo(84988.43 + 80, 2); // net + 0 pénalités + 40×2
    expect(ctx.fields.MontantRestantDu).toBe("84 988,43 €");
  });

  it("sans solde compte (mono-facture) : principal = solde facture, aucune déduction", () => {
    const ctx = buildRelanceContext({
      client: { cardCode: "C1", raisonSociale: "X" },
      invoices: [inv({ balance: 4820, overdueDays: 23 })],
      params: DEFAULT_RELANCE_PARAMS,
    });
    expect(ctx.totals.encaissementsNonAffectes).toBe(0);
    expect(ctx.totals.principal).toBe(4820);
    expect(ctx.fields.LigneDeduction).toBe("");
  });

  it("solde compte ≥ total factures → pas de déduction (principal = total)", () => {
    const ctx = buildRelanceContext({
      client: { cardCode: "C1", raisonSociale: "X" },
      invoices: [inv({ balance: 1000, overdueDays: 30 })],
      params: DEFAULT_RELANCE_PARAMS,
      currentAccountBalance: 5000, // autres débits hors factures → on ne réclame que les factures
    });
    expect(ctx.totals.principal).toBe(1000);
    expect(ctx.totals.encaissementsNonAffectes).toBe(0);
  });

  it("lève si aucune facture", () => {
    expect(() =>
      buildRelanceContext({ client: { cardCode: "C1", raisonSociale: "X" }, invoices: [], params: DEFAULT_RELANCE_PARAMS }),
    ).toThrow();
  });
});
