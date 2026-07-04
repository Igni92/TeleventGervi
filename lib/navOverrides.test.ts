import { describe, it, expect } from "vitest";
import { applyNavOverrides, sanitizeNavOverrides, type NavOverrides } from "./navOverrides";

const GROUPS = [
  { label: null, items: [{ href: "/accueil", label: "Accueil" }] },
  {
    label: "Télévente",
    items: [
      { href: "/console", label: "Console d'appels" },
      { href: "/clients", label: "Clients & plan d'appel" },
    ],
  },
  {
    label: "Entrepôt",
    items: [{ href: "/livraisons", label: "Préparation livraisons" }],
  },
];

describe("navOverrides — applyNavOverrides", () => {
  it("sans surcharge : structure inchangée", () => {
    expect(applyNavOverrides(GROUPS, {})).toEqual(GROUPS);
  });

  it("renomme un libellé (vide = libellé d'origine)", () => {
    const out = applyNavOverrides(GROUPS, { "/console": { label: "Téléphone" }, "/clients": { label: "  " } });
    expect(out[1].items.map((i) => i.label)).toEqual(["Téléphone", "Clients & plan d'appel"]);
  });

  it("déplace une entrée vers un autre groupe et trie par order", () => {
    const out = applyNavOverrides(GROUPS, {
      "/console": { group: "Entrepôt", order: 0 },
      "/livraisons": { order: 1 },
    });
    expect(out.find((g) => g.label === "Entrepôt")!.items.map((i) => i.href)).toEqual(["/console", "/livraisons"]);
    expect(out.find((g) => g.label === "Télévente")!.items.map((i) => i.href)).toEqual(["/clients"]);
  });

  it("groupe cible inconnu → entrée laissée dans son groupe ; groupe vidé retiré", () => {
    const kept = applyNavOverrides(GROUPS, { "/livraisons": { group: "Inexistant" } });
    expect(kept.find((g) => g.label === "Entrepôt")!.items.map((i) => i.href)).toEqual(["/livraisons"]);
    const emptied = applyNavOverrides(GROUPS, { "/livraisons": { group: "Télévente" } });
    expect(emptied.some((g) => g.label === "Entrepôt")).toBe(false);
  });

  it("le groupe Accueil (sans libellé) est intouchable", () => {
    const out = applyNavOverrides(GROUPS, { "/accueil": { label: "Home", group: "Télévente" } });
    expect(out[0]).toEqual(GROUPS[0]);
  });

  it("ne mute pas la structure d'entrée", () => {
    const before = JSON.stringify(GROUPS);
    applyNavOverrides(GROUPS, { "/console": { label: "X", group: "Entrepôt", order: 5 } });
    expect(JSON.stringify(GROUPS)).toBe(before);
  });
});

describe("navOverrides — sanitizeNavOverrides", () => {
  it("borne les champs et ignore l'invalide", () => {
    const raw = {
      "/console": { label: "  Téléphone  ", group: "Entrepôt", order: 3.7, junk: true },
      "/x": { label: "" },                       // vide → entrée retirée
      "pas-une-route": { label: "X" },           // href sans « / » → ignoré
      "/y": "nope",                              // valeur non-objet → ignorée
      "/z": { order: -4 },                       // order borné à ≥ 0
    };
    expect(sanitizeNavOverrides(raw)).toEqual({
      "/console": { label: "Téléphone", group: "Entrepôt", order: 4 },
      "/z": { order: 0 },
    } satisfies NavOverrides);
  });

  it("payload non-objet → aucune surcharge", () => {
    expect(sanitizeNavOverrides(null)).toEqual({});
    expect(sanitizeNavOverrides("x")).toEqual({});
  });
});
