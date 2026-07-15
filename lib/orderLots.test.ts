import { describe, it, expect } from "vitest";
import { pendingLotItems, realLotLines, type RawLotLine } from "./orderLots";

describe("pendingLotItems — lignes SANS lot réel (garde-fou de départ)", () => {
  it("liste vide quand toutes les lignes ont un vrai EM<DocNum>", () => {
    const lines: RawLotLine[] = [
      { itemCode: "FRAISE", quantity: 10, U_NoLot: "EM22948" },
      { itemCode: "FRAMB", quantity: 5, U_NoLot: "EM22950" },
    ];
    expect(pendingLotItems(lines)).toEqual([]);
  });

  it("détecte les 3 formes d'attente : vide, EM_PENDING, EM_FAM:<fruit>", () => {
    const lines: RawLotLine[] = [
      { itemCode: "A", itemName: "Article A", quantity: 4, U_NoLot: "" },
      { itemCode: "B", quantity: 6, U_NoLot: "EM_PENDING" },
      { itemCode: "C", quantity: 8, U_NoLot: "EM_FAM:fraise" },
      { itemCode: "D", quantity: 2, U_NoLot: "EM22948" }, // tracé → exclu
    ];
    const p = pendingLotItems(lines);
    expect(p.map((x) => x.itemCode).sort()).toEqual(["A", "B", "C"]);
    expect(p.find((x) => x.itemCode === "C")?.familyKey).toBe("fraise");
    expect(p.find((x) => x.itemCode === "A")?.itemName).toBe("Article A");
  });

  it("fusionne par article et cumule la quantité EN ATTENTE seulement", () => {
    const lines: RawLotLine[] = [
      { itemCode: "A", quantity: 4, U_NoLot: "EM_PENDING" },
      { itemCode: "A", quantity: 6, U_NoLot: "EM_PENDING" },
      { itemCode: "A", quantity: 3, U_NoLot: "EM22948" }, // ligne tracée → non comptée
    ];
    const p = pendingLotItems(lines);
    expect(p).toHaveLength(1);
    expect(p[0].pendingQty).toBe(10);
  });

  it("un sentinel famille prime sur le générique pour l'affichage", () => {
    const lines: RawLotLine[] = [
      { itemCode: "A", quantity: 4, U_NoLot: "EM_PENDING" },
      { itemCode: "A", quantity: 6, U_NoLot: "EM_FAM:myrtille" },
    ];
    const p = pendingLotItems(lines);
    expect(p[0].familyKey).toBe("myrtille");
    expect(p[0].lot).toBe("EM_FAM:myrtille");
    expect(p[0].pendingQty).toBe(10);
  });

  it("ignore les lignes sans itemCode (robuste)", () => {
    expect(pendingLotItems([{ quantity: 5, U_NoLot: "EM_PENDING" }])).toEqual([]);
  });
});

describe("realLotLines — lignes à VRAI lot EM<DocNum> (contrôle DLC au départ)", () => {
  it("ne garde que les vrais lots, fusionnés par article×lot", () => {
    const lines: RawLotLine[] = [
      { itemCode: "A", itemName: "Art A", quantity: 4, U_NoLot: "EM22948" },
      { itemCode: "A", quantity: 6, U_NoLot: "EM22948" }, // même lot → cumulé
      { itemCode: "A", quantity: 2, U_NoLot: "EM22950" }, // autre lot → distinct
      { itemCode: "B", quantity: 3, U_NoLot: "EM_PENDING" }, // en attente → exclu
      { itemCode: "C", quantity: 1, U_NoLot: "EM_FAM:fraise" }, // sentinel → exclu
    ];
    const r = realLotLines(lines);
    expect(r).toContainEqual({ itemCode: "A", itemName: "Art A", lot: "EM22948", quantity: 10 });
    expect(r).toContainEqual({ itemCode: "A", itemName: null, lot: "EM22950", quantity: 2 });
    expect(r.map((x) => x.lot).sort()).toEqual(["EM22948", "EM22950"]);
  });

  it("liste vide si aucune ligne n'a de vrai lot", () => {
    expect(realLotLines([{ itemCode: "A", quantity: 5, U_NoLot: "EM_PENDING" }])).toEqual([]);
  });
});
