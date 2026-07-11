import { describe, it, expect } from "vitest";
import {
  DEFAULT_SAFEGUARDS_CONFIG,
  SAFEGUARD_DEFS,
  normalizeSafeguardsConfig,
  evaluateLineSafeguards,
  evaluateOrderSafeguards,
  hasBlocking,
  splitViolations,
  type SafeguardsConfig,
  type SafeguardLineCtx,
  type SafeguardOrderCtx,
} from "./safeguards";

/** Config de test : TOUT désactivé sauf les règles passées en override. */
function cfgWith(overrides: Partial<Record<keyof SafeguardsConfig, { mode: "warn" | "block"; params?: Record<string, number> }>>): SafeguardsConfig {
  const cfg = normalizeSafeguardsConfig(null);
  for (const d of SAFEGUARD_DEFS) cfg[d.id].mode = "off";
  for (const [id, o] of Object.entries(overrides)) {
    const rid = id as keyof SafeguardsConfig;
    cfg[rid].mode = o!.mode;
    Object.assign(cfg[rid].params, o!.params ?? {});
  }
  return cfg;
}

const baseLine: SafeguardLineCtx = {
  itemCode: "FRA001", itemName: "Fraise Gariguette", unit: "colis",
  quantity: 10, price: 5, prixAchat: 3, prixConseille: 4.5,
  stockDisponible: 50, poidsKg: 40, habitude: null,
};

describe("normalizeSafeguardsConfig", () => {
  it("null / corrompu → défauts complets, sans lever", () => {
    expect(normalizeSafeguardsConfig(null)).toEqual(DEFAULT_SAFEGUARDS_CONFIG);
    expect(normalizeSafeguardsConfig("garbage")).toEqual(DEFAULT_SAFEGUARDS_CONFIG);
    expect(normalizeSafeguardsConfig(42)).toEqual(DEFAULT_SAFEGUARDS_CONFIG);
  });

  it("mode inconnu ignoré, seuil clampé aux bornes, règle inconnue ignorée", () => {
    const out = normalizeSafeguardsConfig({
      prixSousAchat: { mode: "BLOQUER", params: { margeMinPct: 5000 } },
      volumeVsHabitude: { mode: "block", params: { multiple: 0.1 } },
      regleInventee: { mode: "block" },
    });
    expect(out.prixSousAchat.mode).toBe(DEFAULT_SAFEGUARDS_CONFIG.prixSousAchat.mode); // mode invalide → défaut
    expect(out.prixSousAchat.params.margeMinPct).toBe(100);                            // clamp max
    expect(out.volumeVsHabitude.mode).toBe("block");
    expect(out.volumeVsHabitude.params.multiple).toBe(1);                              // clamp min
    expect((out as Record<string, unknown>).regleInventee).toBeUndefined();
  });

  it("ne mute pas les défauts (copie profonde)", () => {
    const out = normalizeSafeguardsConfig({ prixMax: { mode: "block", params: { prixMaxEur: 42 } } });
    expect(out.prixMax.params.prixMaxEur).toBe(42);
    expect(DEFAULT_SAFEGUARDS_CONFIG.prixMax.params.prixMaxEur).toBe(100);
  });
});

describe("règles PRIX (ligne)", () => {
  it("prixSousAchat : prix < prix d'achat → violation ; ≥ → rien", () => {
    const cfg = cfgWith({ prixSousAchat: { mode: "warn" } });
    expect(evaluateLineSafeguards(cfg, { ...baseLine, price: 2.99 })).toHaveLength(1);
    expect(evaluateLineSafeguards(cfg, { ...baseLine, price: 3 })).toHaveLength(0);
  });

  it("prixSousAchat : marge minimale % relève le seuil", () => {
    const cfg = cfgWith({ prixSousAchat: { mode: "warn", params: { margeMinPct: 10 } } });
    // seuil = 3 × 1,10 = 3,30
    expect(evaluateLineSafeguards(cfg, { ...baseLine, price: 3.2 })).toHaveLength(1);
    expect(evaluateLineSafeguards(cfg, { ...baseLine, price: 3.3 })).toHaveLength(0);
  });

  it("prixSousAchat : prix d'achat inconnu → règle désarmée (jamais de faux positif)", () => {
    const cfg = cfgWith({ prixSousAchat: { mode: "block" } });
    expect(evaluateLineSafeguards(cfg, { ...baseLine, price: 0.5, prixAchat: null })).toHaveLength(0);
  });

  it("ligne 100 % offerte : règles de prix ignorées", () => {
    const cfg = cfgWith({ prixSousAchat: { mode: "block" }, prixManquant: { mode: "warn" } });
    expect(evaluateLineSafeguards(cfg, { ...baseLine, price: 0.01, offerte: true })).toHaveLength(0);
  });

  it("prixLoinSousConseille / prixLoinSurConseille : écart % vs prix conseillé", () => {
    const cfg = cfgWith({
      prixLoinSousConseille: { mode: "warn", params: { ecartPct: 25 } },
      prixLoinSurConseille: { mode: "warn", params: { ecartPct: 100 } },
    });
    // conseillé 4,50 → plancher 3,375 / plafond 9,00
    expect(evaluateLineSafeguards(cfg, { ...baseLine, price: 3.3 }).map((v) => v.ruleId)).toEqual(["prixLoinSousConseille"]);
    expect(evaluateLineSafeguards(cfg, { ...baseLine, price: 9.5 }).map((v) => v.ruleId)).toEqual(["prixLoinSurConseille"]);
    expect(evaluateLineSafeguards(cfg, { ...baseLine, price: 4.5 })).toHaveLength(0);
  });

  it("prixMax : plafond absolu du prix unitaire", () => {
    const cfg = cfgWith({ prixMax: { mode: "block", params: { prixMaxEur: 100 } } });
    const v = evaluateLineSafeguards(cfg, { ...baseLine, price: 450 });
    expect(v).toHaveLength(1);
    expect(v[0].severity).toBe("block");
  });

  it("prixManquant : ligne sans prix signalée seulement si la règle est active", () => {
    expect(evaluateLineSafeguards(cfgWith({}), { ...baseLine, price: null })).toHaveLength(0);
    expect(evaluateLineSafeguards(cfgWith({ prixManquant: { mode: "warn" } }), { ...baseLine, price: null })).toHaveLength(1);
  });
});

describe("règles VOLUME (ligne)", () => {
  it("volumeVsHabitude : > multiple × moyenne client → violation (la demande d'origine : volume > 2× la moyenne)", () => {
    const cfg = cfgWith({ volumeVsHabitude: { mode: "warn", params: { multiple: 2, minCommandes: 3 } } });
    const habitude = { moyenne: 4, nbCommandes: 5 };
    expect(evaluateLineSafeguards(cfg, { ...baseLine, quantity: 9, habitude })).toHaveLength(1);
    expect(evaluateLineSafeguards(cfg, { ...baseLine, quantity: 8, habitude })).toHaveLength(0);
  });

  it("volumeVsHabitude : historique insuffisant ou absent → désarmée", () => {
    const cfg = cfgWith({ volumeVsHabitude: { mode: "block", params: { multiple: 2, minCommandes: 3 } } });
    expect(evaluateLineSafeguards(cfg, { ...baseLine, quantity: 999, habitude: { moyenne: 4, nbCommandes: 2 } })).toHaveLength(0);
    expect(evaluateLineSafeguards(cfg, { ...baseLine, quantity: 999, habitude: null })).toHaveLength(0);
  });

  it("volumeMaxLigne / poidsMaxLigne : plafonds absolus", () => {
    const cfg = cfgWith({
      volumeMaxLigne: { mode: "warn", params: { maxColis: 200 } },
      poidsMaxLigne: { mode: "warn", params: { maxKg: 1000 } },
    });
    const v = evaluateLineSafeguards(cfg, { ...baseLine, quantity: 250, poidsKg: 1200 });
    expect(v.map((x) => x.ruleId).sort()).toEqual(["poidsMaxLigne", "volumeMaxLigne"]);
  });

  it("surVenteStock : quantité > stock dispo ; stock inconnu → désarmée", () => {
    const cfg = cfgWith({ surVenteStock: { mode: "warn" } });
    expect(evaluateLineSafeguards(cfg, { ...baseLine, quantity: 60, stockDisponible: 50 })).toHaveLength(1);
    expect(evaluateLineSafeguards(cfg, { ...baseLine, quantity: 60, stockDisponible: null })).toHaveLength(0);
  });
});

describe("règles COMMANDE (globales)", () => {
  const baseOrder: SafeguardOrderCtx = {
    totalHT: 1000, poidsKg: 500, marge: { margeEur: 200, caEur: 1000 },
    panierMoyen: { moyenneHT: 800, nbCommandes: 6 },
    deliveryDate: "2026-07-15", today: "2026-07-11",
  };

  it("totalMax / totalMin", () => {
    const cfg = cfgWith({
      totalMax: { mode: "warn", params: { maxEur: 8000 } },
      totalMin: { mode: "warn", params: { minEur: 100 } },
    });
    expect(evaluateOrderSafeguards(cfg, { ...baseOrder, totalHT: 9000 }).map((v) => v.ruleId)).toEqual(["totalMax"]);
    expect(evaluateOrderSafeguards(cfg, { ...baseOrder, totalHT: 50 }).map((v) => v.ruleId)).toEqual(["totalMin"]);
    // total 0 (tout au tarif SAP) → pas de faux minimum
    expect(evaluateOrderSafeguards(cfg, { ...baseOrder, totalHT: 0 })).toHaveLength(0);
  });

  it("totalVsPanierMoyen : > multiple × panier moyen, seulement avec assez d'historique", () => {
    const cfg = cfgWith({ totalVsPanierMoyen: { mode: "warn", params: { multiple: 3, minCommandes: 3 } } });
    expect(evaluateOrderSafeguards(cfg, { ...baseOrder, totalHT: 2500 })).toHaveLength(1);
    expect(evaluateOrderSafeguards(cfg, { ...baseOrder, totalHT: 2400 })).toHaveLength(0);
    expect(evaluateOrderSafeguards(cfg, {
      ...baseOrder, totalHT: 99999, panierMoyen: { moyenneHT: 800, nbCommandes: 2 },
    })).toHaveLength(0);
  });

  it("margeCommandeFaible : commande à perte (0 %) et seuil de marge %", () => {
    const zero = cfgWith({ margeCommandeFaible: { mode: "warn", params: { margeMinPct: 0 } } });
    expect(evaluateOrderSafeguards(zero, { ...baseOrder, marge: { margeEur: -50, caEur: 1000 } })).toHaveLength(1);
    expect(evaluateOrderSafeguards(zero, { ...baseOrder, marge: { margeEur: 10, caEur: 1000 } })).toHaveLength(0);
    const dix = cfgWith({ margeCommandeFaible: { mode: "warn", params: { margeMinPct: 10 } } });
    expect(evaluateOrderSafeguards(dix, { ...baseOrder, marge: { margeEur: 50, caEur: 1000 } })).toHaveLength(1); // 5 %
    // aucune ligne costée → désarmée
    expect(evaluateOrderSafeguards(dix, { ...baseOrder, marge: null })).toHaveLength(0);
  });

  it("poidsMaxCommande", () => {
    const cfg = cfgWith({ poidsMaxCommande: { mode: "warn", params: { maxKg: 3000 } } });
    expect(evaluateOrderSafeguards(cfg, { ...baseOrder, poidsKg: 3500 })).toHaveLength(1);
    expect(evaluateOrderSafeguards(cfg, { ...baseOrder, poidsKg: null })).toHaveLength(0);
  });
});

describe("règles CLIENT & LIVRAISON", () => {
  it("encoursDepasse : seuil % de la limite de crédit (100 % = comportement historique)", () => {
    const cent = cfgWith({ encoursDepasse: { mode: "warn", params: { pctLimite: 100 } } });
    expect(evaluateOrderSafeguards(cent, { totalHT: 1, poidsKg: null, marge: null, encours: { balance: 5000, creditLimit: 5000 } })).toHaveLength(1);
    expect(evaluateOrderSafeguards(cent, { totalHT: 1, poidsKg: null, marge: null, encours: { balance: 4999, creditLimit: 5000 } })).toHaveLength(0);
    const zero = cfgWith({ encoursDepasse: { mode: "warn", params: { pctLimite: 80 } } });
    expect(evaluateOrderSafeguards(zero, { totalHT: 1, poidsKg: null, marge: null, encours: { balance: 4000, creditLimit: 5000 } })).toHaveLength(1);
    // pas de limite de crédit → désarmée
    expect(evaluateOrderSafeguards(cent, { totalHT: 1, poidsKg: null, marge: null, encours: { balance: 9999, creditLimit: 0 } })).toHaveLength(0);
  });

  it("livraisonLointaine : > N jours après aujourd'hui", () => {
    const cfg = cfgWith({ livraisonLointaine: { mode: "warn", params: { maxJours: 60 } } });
    expect(evaluateOrderSafeguards(cfg, { totalHT: 1, poidsKg: null, marge: null, deliveryDate: "2026-09-15", today: "2026-07-11" })).toHaveLength(1);
    expect(evaluateOrderSafeguards(cfg, { totalHT: 1, poidsKg: null, marge: null, deliveryDate: "2026-07-20", today: "2026-07-11" })).toHaveLength(0);
  });

  it("doublonJour : signalé seulement quand résolu à true", () => {
    const cfg = cfgWith({ doublonJour: { mode: "warn" } });
    expect(evaluateOrderSafeguards(cfg, { totalHT: 1, poidsKg: null, marge: null, dejaCommandeAujourdhui: true })).toHaveLength(1);
    expect(evaluateOrderSafeguards(cfg, { totalHT: 1, poidsKg: null, marge: null, dejaCommandeAujourdhui: false })).toHaveLength(0);
  });
});

describe("sévérités & helpers", () => {
  it("mode block → severity block (hasBlocking / splitViolations)", () => {
    const cfg = cfgWith({
      prixSousAchat: { mode: "block" },
      volumeMaxLigne: { mode: "warn", params: { maxColis: 5 } },
    });
    const v = evaluateLineSafeguards(cfg, { ...baseLine, price: 1, quantity: 10 });
    expect(v).toHaveLength(2);
    expect(hasBlocking(v)).toBe(true);
    const { warns, blocks } = splitViolations(v);
    expect(blocks.map((x) => x.ruleId)).toEqual(["prixSousAchat"]);
    expect(warns.map((x) => x.ruleId)).toEqual(["volumeMaxLigne"]);
  });

  it("config par défaut : une saisie normale ne déclenche RIEN", () => {
    const cfg = normalizeSafeguardsConfig(null);
    const line = evaluateLineSafeguards(cfg, baseLine);
    expect(line).toHaveLength(0);
    const order = evaluateOrderSafeguards(cfg, {
      totalHT: 500, poidsKg: 200, marge: { margeEur: 150, caEur: 500 },
      panierMoyen: { moyenneHT: 400, nbCommandes: 5 },
      deliveryDate: "2026-07-15", today: "2026-07-11",
      encours: { balance: 100, creditLimit: 5000 }, dejaCommandeAujourdhui: false,
    });
    expect(order).toHaveLength(0);
  });
});
