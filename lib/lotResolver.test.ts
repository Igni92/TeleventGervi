import { describe, it, expect, beforeEach } from "vitest";
import { resolveLot, resolveLotDetailed, resolveLotForSegment, bumpLot, _resetLotCache, type LotMaps } from "./lotResolver";

function maps(): LotMaps {
  return {
    byItemWhs: new Map(), byItem: new Map(), byItemWarehouse: new Map(),
    byItemWhsList: new Map(), byItemList: new Map(), whsOfItemDoc: new Map(),
  };
}

describe("resolveLot — résolution Gervifrais EM<DocNum>", () => {
  it("priorise byItemWhs (item × entrepôt) sur byItem", () => {
    const m = maps();
    m.byItem.set("FE1SL", 22000);
    m.byItemWhs.set("FE1SL|000", 22739);
    expect(resolveLot(m, "FE1SL", "000")).toBe("EM22739");
  });

  it("retombe sur byItem si l'entrepôt précis n'a pas de match", () => {
    const m = maps();
    m.byItem.set("FE1SL", 22000);
    m.byItemWhs.set("FE1SL|R1", 22300);
    expect(resolveLot(m, "FE1SL", "000")).toBe("EM22000");
  });

  it("retombe sur byItem si warehouseCode est undefined", () => {
    const m = maps();
    m.byItem.set("MVM12L", 19111);
    m.byItemWhs.set("MVM12L|01", 19222);
    expect(resolveLot(m, "MVM12L", undefined)).toBe("EM19111");
  });

  it("renvoie le fallback EM0000 si rien ne correspond", () => {
    expect(resolveLot(maps(), "INCONNU", "01")).toBe("EM0000");
  });
});

describe("resolveLotDetailed — magasin du lot (alignement vente à découvert)", () => {
  it("source 'whs' → magasin = l'entrepôt interrogé", () => {
    const m = maps();
    m.byItemWhs.set("FE1SL|000", 22739);
    const r = resolveLotDetailed(m, "FE1SL", "000");
    expect(r).toMatchObject({ lot: "EM22739", source: "whs", warehouse: "000" });
  });

  it("repli 'item' → magasin = celui de la dernière EM (byItemWarehouse)", () => {
    // La ligne est sur 000 (jamais reçu là) ; la dernière EM de l'article est sur 01.
    const m = maps();
    m.byItem.set("FRAMB", 23074);
    m.byItemWarehouse.set("FRAMB", "01");
    const r = resolveLotDetailed(m, "FRAMB", "000");
    expect(r).toMatchObject({ lot: "EM23074", source: "item", warehouse: "01" });
  });

  it("repli 'item' sans magasin connu → warehouse null", () => {
    const m = maps();
    m.byItem.set("X", 100);
    expect(resolveLotDetailed(m, "X", "01").warehouse).toBeNull();
  });

  it("aucune correspondance → lot et magasin null", () => {
    expect(resolveLotDetailed(maps(), "INCONNU", "01")).toEqual({
      lot: null, source: null, docNum: null, warehouse: null,
    });
  });
});

describe("resolveLotForSegment — lot choisi selon l'affectation des EM (Tous/Export/GMS/CHR)", () => {
  // Historique de FRAISE sur 01 : EM 300 (export, la plus récente), EM 200 (Tous),
  // EM 100 (GMS). L'export prend SON arrivage, le GMS prend le sien, un CHR sans
  // EM dédiée prend le stock commun (Tous) — jamais le lot export.
  function fixture() {
    const m = maps();
    m.byItemWhsList.set("FRAISE|01", [300, 200, 100]);
    m.byItemList.set("FRAISE", [300, 200, 100]);
    m.whsOfItemDoc.set("FRAISE|300", "01");
    m.whsOfItemDoc.set("FRAISE|200", "01");
    const affects = new Map<number, string>([[300, "EXPORT"], [100, "GMS"]]);
    return { m, affects };
  }

  it("client EXPORT → l'EM affectée export, même si plus récente qu'une « Tous »", () => {
    const { m, affects } = fixture();
    expect(resolveLotForSegment(m, affects, "FRAISE", "01", "EXPORT"))
      .toMatchObject({ lot: "EM300", source: "whs", warehouse: "01" });
  });

  it("client GMS → SA propre EM, pas le dernier arrivage export", () => {
    const { m, affects } = fixture();
    expect(resolveLotForSegment(m, affects, "FRAISE", "01", "GMS")).toMatchObject({ lot: "EM100" });
  });

  it("client CHR sans EM dédiée → l'EM « Tous » la plus récente (saute l'export)", () => {
    const { m, affects } = fixture();
    expect(resolveLotForSegment(m, affects, "FRAISE", "01", "CHR")).toMatchObject({ lot: "EM200" });
  });

  it("client sans segment → uniquement les EM « Tous »", () => {
    const { m, affects } = fixture();
    expect(resolveLotForSegment(m, affects, "FRAISE", "01", null)).toMatchObject({ lot: "EM200" });
  });

  it("que des EM affectées à d'AUTRES segments → lot null (l'appelant part en EM_PENDING)", () => {
    const m = maps();
    m.byItemWhsList.set("FRAMB|01", [500]);
    m.byItemList.set("FRAMB", [500]);
    const affects = new Map<number, string>([[500, "EXPORT"]]);
    expect(resolveLotForSegment(m, affects, "FRAMB", "01", "GMS"))
      .toEqual({ lot: null, source: null, docNum: null, warehouse: null });
  });

  it("repli item×entrepôt → item : magasin = celui de l'EM retenue", () => {
    const { m, affects } = fixture();
    // Ligne saisie sur 000 (jamais reçu là) → repli item, magasin de l'EM 300.
    expect(resolveLotForSegment(m, affects, "FRAISE", "000", "EXPORT"))
      .toMatchObject({ lot: "EM300", source: "item", warehouse: "01" });
  });
});

describe("bumpLot — injection live après création d'un PDN", () => {
  beforeEach(() => _resetLotCache());

  it("est un no-op tant que le cache n'a pas été initialisé", () => {
    // Pas de throw, et resolveLot continue de répondre via la map qu'on lui passe
    bumpLot("FE1SL", "000", 99999);
    expect(resolveLot(maps(), "FE1SL", "000")).toBe("EM0000");
  });
});
