import { describe, it, expect } from "vitest";
import { renderBlOfficiel, blDateLabel, blPageCount, type BlDoc } from "./blOfficiel";

/**
 * Édition BL officielle — calibrée sur le BL SAP de référence (FANTASY
 * n°24011987 du VEN. 10.07.2026, cf. docs) : pagination, formats Crystal
 * (point sur les lignes, virgule sur les totaux), contenus clés.
 */

const DOC: BlDoc = {
  docNum: 24011987,
  ref: "FAN.GE.054.26-27",
  dateLabel: blDateLabel("2026-07-10"),
  clientEmail: "herve@fantasy.com.mv",
  clientName: "FANTASY PVT. LTD",
  addressLines: ["M. VELAALUGE, 1ST FLOOR", "FAREEDHEE MAGU, P.O. BOX 2057", "MV 20214 MALE", "MALDIVE"],
  carrierLabel: "SEA FRIGO / STM RUNGIS",
  lines: [
    {
      barcode: "3540900000078", colis: 48, fruit: "Fraise", marque: "Hoogstraten",
      variete: "Karima", calibre: "2AE", pays: "Belgique", condt: "8x500g",
      lot: "EM23126", qty: 192, unit: "KG", puht: 7, tvaCode: "C1", totalHt: 1344,
    },
    {
      barcode: null, colis: 22, fruit: "Framboise", marque: "Driscolls",
      variete: null, calibre: null, pays: "Portugal", condt: "12x125g",
      lot: "EM23133", qty: 264, unit: "pie", puht: 2.5, tvaCode: "C1", totalHt: 660,
    },
  ],
  totalColis: 178,
  totalWeightKg: 434.1,
  expenses: [
    { name: "INTERFEL", taxCode: "C4", amount: 9.08, kind: "parafiscale" },
    { name: "DROIT DE GARDE", taxCode: "C4", amount: 3.56, kind: "parafiscale" },
    { name: "PAL. EUROPE", taxCode: "C4", amount: 0, kind: "prestation" },
    { name: "FRAIS ADM.", taxCode: "C4", amount: 0, kind: "prestation" },
  ],
  sousTotal: 4325.6,
  totalHt: 4338.24,
  vatRows: [{ code: "C1", ratePct: 0, base: 4338.24, amount: 0 }],
  totalTtc: 4338.24,
};

describe("blDateLabel", () => {
  it("2026-07-10 (vendredi) → « VEN. 10.07.2026 »", () => {
    expect(blDateLabel("2026-07-10")).toBe("VEN. 10.07.2026");
  });
});

describe("blPageCount — pages de lignes + page récap", () => {
  it("11 lignes → 2 pages (comme le BL de référence)", () => expect(blPageCount(11)).toBe(2));
  it("12 lignes → 2 pages ; 13 lignes → 3 pages", () => {
    expect(blPageCount(12)).toBe(2);
    expect(blPageCount(13)).toBe(3);
  });
  it("0 ligne → 2 pages (page vide + récap)", () => expect(blPageCount(0)).toBe(2));
});

describe("renderBlOfficiel — contenu du document", () => {
  const html = renderBlOfficiel([DOC], { logoUrl: "https://app/LogoSansFond.png", autoPrint: false });

  it("en-tête : titre, référence rouge, PAGE 1/2 et 2/2, client, email", () => {
    expect(html).toContain("BON LIVRAISON");
    expect(html).toContain("N° 24011987 - VEN. 10.07.2026");
    expect(html).toContain("FAN.GE.054.26-27");
    expect(html).toContain("PAGE 1 / 2");
    expect(html).toContain("PAGE 2 / 2");
    expect(html).toContain("FANTASY PVT. LTD");
    expect(html).toContain("Email : herve@fantasy.com.mv");
  });

  it("lignes : format PRIX AU POINT (« 1 344.00 € »), qté une décimale, lot et calibre", () => {
    expect(html).toContain("1 344.00 €");   // HT ligne — quirk Crystal conservé
    expect(html).toContain("192.0");
    expect(html).toContain("EM23126");
    expect(html).toContain("2AE");
    expect(html).toContain("8x500g");
  });

  it("code-barres : EAN rendu en SVG ; absent → « Code is empty »", () => {
    expect(html).toContain("3 540900 000078");
    expect(html).toContain("Code is empty");
  });

  it("récap : sous-total SANS milliers, totaux À LA VIRGULE, base/taux parafiscaux", () => {
    expect(html).toContain("4325,60 €");            // sous-total (sans séparateur)
    expect(html).toContain("4 338,24 €");           // total HT / TTC (avec espace)
    expect(html).toContain("TVA C1 (0,0%) de 4338,24");
    expect(html).toContain("178 Colis");            // base DROIT DE GARDE
    expect(html).toContain("0,020€");               // taux DROIT DE GARDE (3,56 € / 178)
    expect(html).toContain("0,210%");               // taux INTERFEL (9,08 / 4325,60)
    expect(html).toContain("Escompte pour Règlement Comptant : 0.00%");
  });

  it("transporteur : « Livré par » + rappel pied de page, total colis/poids", () => {
    expect(html).toContain("Livré par SEA FRIGO / STM RUNGIS");
    expect(html).toContain("434.1 KG");
  });

  it("plusieurs BL → toutes les pages dans UN seul document", () => {
    const two = renderBlOfficiel([DOC, { ...DOC, docNum: 24011988 }], { logoUrl: "x", autoPrint: false });
    expect(two).toContain("N° 24011987");
    expect(two).toContain("N° 24011988");
    expect((two.match(/class="page"/g) ?? []).length).toBe(4);
  });
});
