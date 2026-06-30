import { describe, it, expect, beforeEach } from "vitest";
import { resolveLot, resolveLotDetailed, bumpLot, _resetLotCache, type LotMaps } from "./lotResolver";

function maps(): LotMaps {
  return { byItemWhs: new Map(), byItem: new Map(), byItemWarehouse: new Map() };
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

describe("bumpLot — injection live après création d'un PDN", () => {
  beforeEach(() => _resetLotCache());

  it("est un no-op tant que le cache n'a pas été initialisé", () => {
    // Pas de throw, et resolveLot continue de répondre via la map qu'on lui passe
    bumpLot("FE1SL", "000", 99999);
    expect(resolveLot(maps(), "FE1SL", "000")).toBe("EM0000");
  });
});
