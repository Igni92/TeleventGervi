import { describe, it, expect } from "vitest";
import { consolidateDeliveryLines } from "./livraisonLines";
import type { Line } from "./livraisonView";

/**
 * Consolidation d'affichage des lignes d'un BL — regroupe un article racheté
 * après manquant (2ᵉ code, même désignation) et écarte les lignes à quantité 0.
 * Module PUR → test 100 % hors-ligne.
 */
const mk = (p: Partial<Line> & { itemCode: string; quantity: number; colis: number }): Line => ({
  itemName: "MURE",
  weightKg: 0,
  warehouse: null,
  marque: null,
  condt: null,
  pays: null,
  variete: null,
  calibre: null,
  ...p,
});

describe("consolidateDeliveryLines", () => {
  it("cas ABRE : mûre rachetée après manquant (2 codes, même désignation) → 1 colis complet", () => {
    const out = consolidateDeliveryLines([
      mk({ itemCode: "MURE_ORIG", quantity: 0, colis: 0 }),        // originale ramenée à 0
      mk({ itemCode: "MURE_STOCK", quantity: 6, colis: 0.5 }),     // servi du stock
      mk({ itemCode: "MURE_ACHAT", quantity: 6, colis: 0.5 }),     // racheté
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].colis).toBe(1);
    expect(out[0].quantity).toBe(12);
    // Le code représentatif est une ligne servie (quantité la plus grosse).
    expect(out[0].itemCode).toBe("MURE_STOCK");
    // Tous les codes fusionnés sont retenus — y compris l'originale à 0 — pour
    // préserver le statut « manquant » quel que soit le code concerné.
    expect(out[0].mergedCodes).toEqual(["MURE_ORIG", "MURE_STOCK", "MURE_ACHAT"]);
  });

  it("écarte une ligne à quantité 0 isolée (rien à préparer)", () => {
    const out = consolidateDeliveryLines([
      mk({ itemCode: "A", quantity: 0, colis: 0 }),
      mk({ itemCode: "B", itemName: "FRAISE", quantity: 10, colis: 1 }),
    ]);
    expect(out.map((l) => l.itemCode)).toEqual(["B"]);
  });

  it("ne fusionne PAS deux produits de désignation différente (origine distincte)", () => {
    const out = consolidateDeliveryLines([
      mk({ itemCode: "MURE_FR", quantity: 6, colis: 0.5, pays: "FRANCE" }),
      mk({ itemCode: "MURE_ES", quantity: 6, colis: 0.5, pays: "ESPAGNE" }),
    ]);
    expect(out).toHaveLength(2);
  });

  it("code + entrepôt représentatifs = la ligne de plus grosse quantité", () => {
    const out = consolidateDeliveryLines([
      mk({ itemCode: "PETIT", quantity: 2, colis: 0.2, warehouse: "01" }),
      mk({ itemCode: "GROS", quantity: 8, colis: 0.8, warehouse: "R1" }),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].itemCode).toBe("GROS");
    expect(out[0].warehouse).toBe("R1");
    expect(out[0].colis).toBe(1);
  });

  it("laisse intacte une commande déjà propre (une ligne par produit)", () => {
    const lines = [
      mk({ itemCode: "A", itemName: "FRAISE", quantity: 10, colis: 1 }),
      mk({ itemCode: "B", itemName: "MURE", quantity: 12, colis: 1 }),
    ];
    const out = consolidateDeliveryLines(lines);
    expect(out).toHaveLength(2);
    expect(out.map((l) => l.colis)).toEqual([1, 1]);
  });
});
