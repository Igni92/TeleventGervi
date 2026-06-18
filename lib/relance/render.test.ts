import { describe, it, expect } from "vitest";
import { renderRelance, TEMPLATES } from "./render";
import { buildRelanceContext, type RelanceInvoice } from "./fields";
import { DEFAULT_RELANCE_PARAMS } from "./params";
import { RELANCE_LEVELS } from "./levels";

const invoices: RelanceInvoice[] = [
  { docEntry: 1, docNum: 457, docDate: new Date("2026-04-12T08:00:00Z"), dueDate: new Date("2026-05-12T08:00:00Z"), docTotal: 4820, balance: 4820, overdueDays: 35 },
  { docEntry: 2, docNum: 461, docDate: new Date("2026-04-20T08:00:00Z"), dueDate: new Date("2026-05-20T08:00:00Z"), docTotal: 1200, balance: 1200, overdueDays: 27 },
];

const ctx = buildRelanceContext({
  client: { cardCode: "C1", raisonSociale: "SARL LES DÉLICES", civilite: "Monsieur" },
  invoices,
  params: DEFAULT_RELANCE_PARAMS,
  dateMiseEnDemeure: new Date("2026-05-30T08:00:00Z"),
});

describe("renderRelance — modèles R0→R5 (NT-2026-RC-01 §5)", () => {
  it("aucun champ {{…}} ne subsiste après fusion, pour tous les niveaux", () => {
    for (const lvl of RELANCE_LEVELS) {
      const out = renderRelance(lvl.code, ctx);
      expect(out.subject).not.toMatch(/\{\{/);
      expect(out.html).not.toMatch(/\{\{/);
      expect(out.text).not.toMatch(/\{\{/);
    }
  });

  it("fusionne l'objet (champ dans le sujet de R0)", () => {
    const out = renderRelance("R0", ctx);
    expect(out.subject).toBe("Rappel d'échéance — Facture 457");
  });

  it("R2+ insèrent le tableau multi-factures (HTML + texte)", () => {
    const out = renderRelance("R2", ctx);
    expect(out.html).toContain("<table");
    expect(out.html).toContain("457");
    expect(out.html).toContain("461");
    expect(out.text).toContain("Facture 457");
    expect(out.text).toContain("Facture 461");
  });

  it("R4/R5 portent la mention recommandée ; R0 non", () => {
    expect(renderRelance("R4", ctx).recommande).toBe(true);
    expect(renderRelance("R5", ctx).recommande).toBe(true);
    expect(renderRelance("R0", ctx).recommande).toBe(false);
    expect(renderRelance("R4", ctx).text).toContain("LETTRE RECOMMANDÉE");
  });

  it("R3 affiche le décompte (principal / pénalités / IFR / total)", () => {
    const out = renderRelance("R3", ctx);
    expect(out.text).toContain("Principal restant dû : 6 020,00 €"); // 4820 + 1200
    expect(out.text).toContain("Indemnité forfaitaire de recouvrement : 80,00 €"); // 40 × 2
    expect(out.text).toContain("Total dû : 6 100,00 €"); // 6020 + 0 + 80
    // Sans encaissement à déduire, pas de ligne de déduction.
    expect(out.text).not.toContain("Règlements et avoirs");
  });

  it("R3 affiche la déduction des encaissements quand le solde compte est inférieur", () => {
    const ctxDed = buildRelanceContext({
      client: { cardCode: "C1", raisonSociale: "FANTASY", civilite: "Monsieur" },
      invoices, // total 6 020,00 €
      params: DEFAULT_RELANCE_PARAMS,
      currentAccountBalance: 3000, // 3 020 encaissés non affectés
    });
    const out = renderRelance("R3", ctxDed);
    expect(out.text).toContain("Total des factures échues : 6 020,00 €");
    expect(out.text).toContain("Règlements et avoirs reçus non affectés : -3 020,00 €");
    expect(out.text).toContain("Principal restant dû : 3 000,00 €");
    expect(out.text).not.toMatch(/\{\{/);
  });

  it("R5 reprend la date de mise en demeure", () => {
    expect(renderRelance("R5", ctx).text).toContain("30/05/2026");
  });

  it("R5 sans date de mise en demeure → clause neutre (jamais « du — »)", () => {
    const ctxNoDate = buildRelanceContext({
      client: { cardCode: "C1", raisonSociale: "SARL LES DÉLICES", civilite: "Monsieur" },
      invoices,
      params: DEFAULT_RELANCE_PARAMS,
    });
    const out = renderRelance("R5", ctxNoDate);
    expect(out.text).toContain("étant restées sans effet");
    expect(out.text).not.toContain("du —");
    expect(out.text).not.toMatch(/\{\{/);
  });

  it("expose un modèle pour chacun des 6 niveaux", () => {
    expect(Object.keys(TEMPLATES).sort()).toEqual(["R0", "R1", "R2", "R3", "R4", "R5"]);
  });
});
