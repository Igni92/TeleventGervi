import { describe, it, expect } from "vitest";
import {
  buildWhsBudget,
  remainingForItem,
  pickReceiptWarehouse,
  consumeBudget,
} from "./receiptRetro";

describe("receiptRetro — budget par (article × magasin)", () => {
  it("agrège les quantités reçues par article et magasin", () => {
    const b = buildWhsBudget([
      { itemCode: "FRAMB12PD", warehouseCode: "01", pieceQty: 600 },
      { itemCode: "FRAMB12PD", warehouseCode: "01", pieceQty: 120 },
      { itemCode: "FRAMB12PD", warehouseCode: "000", pieceQty: 50 },
      { itemCode: "MYRT", warehouseCode: "R1", pieceQty: 12 },
    ]);
    expect(remainingForItem(b, "FRAMB12PD")).toBe(770);
    expect(remainingForItem(b, "MYRT")).toBe(12);
    expect(remainingForItem(b, "INCONNU")).toBe(0);
  });

  it("ignore les lignes invalides (qté ≤ 0, magasin/article manquant)", () => {
    const b = buildWhsBudget([
      { itemCode: "X", warehouseCode: "01", pieceQty: 0 },
      { itemCode: "", warehouseCode: "01", pieceQty: 10 },
      { itemCode: "X", warehouseCode: "", pieceQty: 10 },
      { itemCode: "X", warehouseCode: "01", pieceQty: 5 },
    ]);
    expect(remainingForItem(b, "X")).toBe(5);
  });

  it("garde le magasin courant de la ligne s'il a reçu du stock", () => {
    const b = buildWhsBudget([
      { itemCode: "X", warehouseCode: "01", pieceQty: 100 },
      { itemCode: "X", warehouseCode: "000", pieceQty: 300 },
    ]);
    expect(pickReceiptWarehouse(b, "X", "01")).toBe("01");
  });

  it("déplace vers le magasin de réception au plus gros reliquat si le magasin courant n'a rien reçu", () => {
    // Cœur du bug : la ligne est sur 000 (sans stock), l'EM est arrivée sur 01.
    const b = buildWhsBudget([{ itemCode: "FRAMB", warehouseCode: "01", pieceQty: 240 }]);
    expect(pickReceiptWarehouse(b, "FRAMB", "000")).toBe("01");
  });

  it("choisit le plus gros reliquat entre plusieurs magasins de réception", () => {
    const b = buildWhsBudget([
      { itemCode: "X", warehouseCode: "000", pieceQty: 50 },
      { itemCode: "X", warehouseCode: "R1", pieceQty: 400 },
    ]);
    expect(pickReceiptWarehouse(b, "X", "01")).toBe("R1");
  });

  it("renvoie null si l'EM ne couvre pas l'article", () => {
    const b = buildWhsBudget([{ itemCode: "X", warehouseCode: "01", pieceQty: 10 }]);
    expect(pickReceiptWarehouse(b, "AUTRE", "01")).toBeNull();
  });

  it("consomme le budget du magasin affecté (jamais négatif) et bascule au suivant", () => {
    const b = buildWhsBudget([
      { itemCode: "X", warehouseCode: "01", pieceQty: 100 },
      { itemCode: "X", warehouseCode: "000", pieceQty: 100 },
    ]);
    // 1re ligne (120 pie) couverte par 01 → 01 épuisé, bascule sur 000.
    const w1 = pickReceiptWarehouse(b, "X", "01");
    expect(w1).toBe("01");
    consumeBudget(b, "X", w1!, 120);
    expect(b.get("X")!.get("01")).toBe(0);
    const w2 = pickReceiptWarehouse(b, "X", "01"); // 01 vide → bascule
    expect(w2).toBe("000");
    expect(remainingForItem(b, "X")).toBe(100);
  });
});
