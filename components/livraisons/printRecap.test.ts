import { describe, it, expect } from "vitest";
import { renderOrderRecapHtml, type PrintDoc, type PrintContext } from "./printRecap";

/**
 * Smoke test du Bon de préparation (demandes direction du 12/07) : en-tête
 * logistique complet, colonne ⚠ fixe, lignes manquantes encadrées, sans Qté,
 * police Times New Roman, BL sous le client (plus au-dessus de la date).
 */

const baseDoc: PrintDoc = {
  docNum: 24012027,
  cardCode: "C0042",
  cardName: "FANTASY PVT",
  clientType: "EXPORT",
  colis: 78,
  weightKg: 261,
  lines: [
    { itemCode: "FR8", itemName: "Fraise", quantity: 384, colis: 48, weightKg: 192, marque: "Belorta", condt: "8x500g", pays: "Belgique", lot: "EM23568" },
    { itemCode: "FR16", itemName: "Fraise", quantity: 64, colis: 4, weightKg: 16, marque: "Belorta", condt: "16x250g", pays: "Belgique", lot: null },
    { itemCode: "FRB12", itemName: "Framboise", quantity: 264, colis: 22, weightKg: 33, marque: "Driscolls", condt: "12x125g", pays: "Portugal", lot: "EM23570" },
  ],
};

const baseCtx: PrintContext = {
  dateLabel: "dimanche 12 juillet 2026",
  carrierName: "SEAFRIGO",
  tourneeLabel: "STM",
  pickupTime: "08:00",
  preparedBy: "J. Michel",
  missingCodes: new Set(["FR16"]),
};

describe("renderOrderRecapHtml — en-tête logistique", () => {
  it("affiche les 6 cases : Client, Type, Transporteur, Tournée, Heure enlèvt, Préparée par", () => {
    const html = renderOrderRecapHtml(baseDoc, baseCtx);
    for (const k of ["Client", "Type", "Transporteur", "Tournée", "Heure enlèvt", "Préparée par"]) {
      expect(html).toContain(k);
    }
    expect(html).toContain("SEAFRIGO");
    expect(html).toContain("STM");
    expect(html).toContain("EXPORT");
    expect(html).toContain("J. Michel");
  });

  it("met le n° de BL SOUS le client, plus au-dessus de la date", () => {
    const html = renderOrderRecapHtml(baseDoc, baseCtx);
    expect(html).toContain("BL n°24012027");        // dans la case Client (sub)
    expect(html).not.toContain('class="num">BL');   // ancienne ligne BL de l'entête supprimée
    expect(html).toContain("Livraison du <b>dimanche 12 juillet 2026</b>");
  });

  it("formate l'heure d'enlèvement « 08:00 » → « 8H00 » avec la case SMS", () => {
    const html = renderOrderRecapHtml(baseDoc, baseCtx);
    expect(html).toContain("8H00");
    expect(html).toContain("SMS transporteur");
  });

  it("montre « — » quand transporteur/tournée/heure/préparateur sont absents", () => {
    const html = renderOrderRecapHtml(baseDoc, { dateLabel: "lundi 13 juillet 2026" });
    expect(html).toContain("Non affecté");   // transporteur
    expect(html).not.toContain("SMS transporteur"); // pas d'heure → pas de case SMS
  });
});

describe("renderOrderRecapHtml — lignes articles", () => {
  it("n'affiche PLUS la colonne Qté (pièces), garde Colis et Poids", () => {
    const html = renderOrderRecapHtml(baseDoc, baseCtx);
    expect(html).toContain(">Colis<");
    expect(html).toContain("Poids (kg)");
    expect(html).not.toContain(">Qté<");
  });

  it("place l'icône ⚠ dans une colonne dédiée sur les lignes manquantes", () => {
    const html = renderOrderRecapHtml(baseDoc, baseCtx);
    expect(html).toContain('class="warn">⚠</td>');   // ligne manquante
    expect(html).toContain('class="warn"></td>');     // lignes non manquantes / tfoot
  });

  it("encadre la ligne manquante (classe .missing) sans la barrer", () => {
    const html = renderOrderRecapHtml(baseDoc, baseCtx);
    expect(html).toContain('<tr class="missing">');
    expect(html).not.toContain("line-through");        // plus de texte barré
    expect(html).toContain("tr.missing td { border-top");
  });

  it("rappelle les articles manquants dans l'encart dédié", () => {
    const html = renderOrderRecapHtml(baseDoc, baseCtx);
    expect(html).toContain("Articles manquants (1)");
  });
});

describe("renderOrderRecapHtml — police & robustesse", () => {
  it("utilise une police conventionnelle (Times New Roman)", () => {
    const html = renderOrderRecapHtml(baseDoc, baseCtx);
    expect(html).toContain('"Times New Roman"');
    expect(html).not.toContain("Segoe UI");
  });

  it("échappe le HTML des champs libres (anti-injection)", () => {
    const html = renderOrderRecapHtml(
      { ...baseDoc, cardName: "A<b>&\"X" },
      baseCtx,
    );
    expect(html).toContain("A&lt;b&gt;&amp;&quot;X");
  });

  it("insère l'origine fournie dans l'URL du logo", () => {
    const html = renderOrderRecapHtml(baseDoc, baseCtx, "https://app.example");
    expect(html).toContain("https://app.example/logo-mark.png");
  });
});
