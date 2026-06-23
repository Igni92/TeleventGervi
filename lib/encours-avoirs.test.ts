import { describe, it, expect } from "vitest";
import { attributeAvoirs, type CreditNoteRef, type OpenInvoiceRef } from "./encours-avoirs";

const inv = (docEntry: number, balance: number): OpenInvoiceRef => ({ docEntry, balance });
const cn = (
  docEntry: number,
  amount: number,
  baseInvoiceEntry: number | null,
): CreditNoteRef => ({ docEntry, docNum: docEntry, docDate: null, amount, baseInvoiceEntry });

describe("attributeAvoirs — rattachement avoir → facture sans double-comptage", () => {
  it("avoir lié à une facture ouverte, dans le budget → attribué", () => {
    const r = attributeAvoirs([inv(100, 1000)], [cn(200, 300, 100)], /* encaisse */ 300);
    expect(r.attributedTotal).toBe(300);
    expect(r.unattributedTotal).toBe(0);
    expect(r.byInvoice.get(100)).toEqual([
      { docEntry: 200, docNum: 200, docDate: null, amount: 300 },
    ]);
  });

  it("avoir sans lien (baseInvoiceEntry null) → reste non affecté", () => {
    const r = attributeAvoirs([inv(100, 1000)], [cn(200, 300, null)], 300);
    expect(r.attributedTotal).toBe(0);
    expect(r.unattributedTotal).toBe(300);
    expect(r.byInvoice.size).toBe(0);
  });

  it("avoir pointant une facture non ouverte/hors périmètre → non affecté", () => {
    const r = attributeAvoirs([inv(100, 1000)], [cn(200, 300, 999)], 300);
    expect(r.attributedTotal).toBe(0);
    expect(r.unattributedTotal).toBe(300);
  });

  it("PLAFOND anti double-comptage : budget (encaissé) limite l'attribution", () => {
    // Avoir 500 lié à la facture, mais l'encaissé global n'est que de 200 :
    // on ne ré-impute que 200 (le reste resterait du déjà-payé non expliqué).
    const r = attributeAvoirs([inv(100, 1000)], [cn(200, 500, 100)], /* encaisse */ 200);
    expect(r.attributedTotal).toBe(200);
    expect(r.unattributedTotal).toBe(300);
    expect(r.byInvoice.get(100)?.[0].amount).toBe(200);
  });

  it("avoir > solde de la facture → borné au solde, reliquat non affecté", () => {
    const r = attributeAvoirs([inv(100, 250)], [cn(200, 400, 100)], /* encaisse */ 1000);
    expect(r.attributedTotal).toBe(250);
    expect(r.unattributedTotal).toBe(150);
    expect(r.byInvoice.get(100)?.[0].amount).toBe(250);
  });

  it("plusieurs avoirs sur la même facture (ordre ancien → récent)", () => {
    const r = attributeAvoirs(
      [inv(100, 1000)],
      [cn(210, 100, 100), cn(205, 200, 100)],
      /* encaisse */ 1000,
    );
    expect(r.attributedTotal).toBe(300);
    // Trié par docEntry croissant : 205 puis 210.
    expect(r.byInvoice.get(100)).toEqual([
      { docEntry: 205, docNum: 205, docDate: null, amount: 200 },
      { docEntry: 210, docNum: 210, docDate: null, amount: 100 },
    ]);
  });

  it("encaissé nul (aucun déjà-payé) → rien n'est ré-imputé", () => {
    const r = attributeAvoirs([inv(100, 1000)], [cn(200, 300, 100)], 0);
    expect(r.attributedTotal).toBe(0);
    expect(r.unattributedTotal).toBe(300);
  });
});
