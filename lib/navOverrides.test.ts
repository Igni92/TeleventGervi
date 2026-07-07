import { describe, it, expect } from "vitest";
import {
  applyNavOverrides, sanitizeNavOverrides, toEditState, fromEditState,
  moveNavRowBefore, swapNavRows,
  type NavOverrides,
} from "./navOverrides";

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

describe("navOverrides — état d'édition (toEditState ⇄ fromEditState)", () => {
  it("toEditState reflète les surcharges (libellé saisi, entrée déplacée), Accueil exclu", () => {
    const state = toEditState(GROUPS, { "/console": { label: "Téléphone", group: "Entrepôt", order: 0 } });
    expect(state.map((g) => g.label)).toEqual(["Télévente", "Entrepôt"]);
    expect(state[0].rows.map((r) => r.href)).toEqual(["/clients"]);
    const entrepot = state[1];
    expect(entrepot.rows.map((r) => r.href)).toEqual(["/console", "/livraisons"]);
    expect(entrepot.rows[0]).toEqual({
      href: "/console", defaultLabel: "Console d'appels", defaultGroup: "Télévente", label: "Téléphone",
    });
  });

  it("fromEditState ne stocke que les vrais écarts (ordre explicite partout)", () => {
    const state = toEditState(GROUPS, {});
    state[0].rows[0].label = "Téléphone";                       // renommage
    const [moved] = state[0].rows.splice(1, 1);                 // /clients → Entrepôt
    state[1].rows.unshift(moved);
    const ov = fromEditState(state);
    expect(ov["/console"]).toEqual({ order: 0, label: "Téléphone" });
    expect(ov["/clients"]).toEqual({ order: 0, group: "Entrepôt" });
    expect(ov["/livraisons"]).toEqual({ order: 1 });
  });

  it("aller-retour : appliquer fromEditState(toEditState(ov)) redonne la même structure", () => {
    const ov: NavOverrides = { "/console": { label: "Téléphone", group: "Entrepôt", order: 9 } };
    const roundTripped = fromEditState(toEditState(GROUPS, ov));
    expect(applyNavOverrides(GROUPS, roundTripped)).toEqual(applyNavOverrides(GROUPS, ov));
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

describe("navOverrides — glisser-déposer (moveNavRowBefore / swapNavRows)", () => {
  const base = () => toEditState(GROUPS, {});
  const hrefs = (state: ReturnType<typeof base>, label: string) =>
    state.find((g) => g.label === label)!.rows.map((r) => r.href);

  it("insère AVANT une autre ligne (réordre dans le même groupe)", () => {
    const next = moveNavRowBefore(base(), "/clients", "Télévente", "/console");
    expect(hrefs(next, "Télévente")).toEqual(["/clients", "/console"]);
  });

  it("déplace vers un AUTRE groupe, en fin (beforeHref = null)", () => {
    const next = moveNavRowBefore(base(), "/console", "Entrepôt", null);
    expect(hrefs(next, "Télévente")).toEqual(["/clients"]);
    expect(hrefs(next, "Entrepôt")).toEqual(["/livraisons", "/console"]);
  });

  it("déplace vers un autre groupe, AVANT une ligne", () => {
    const next = moveNavRowBefore(base(), "/livraisons", "Télévente", "/clients");
    expect(hrefs(next, "Télévente")).toEqual(["/console", "/livraisons", "/clients"]);
    expect(hrefs(next, "Entrepôt")).toEqual([]);
  });

  it("no-op si lâchée sur elle-même ou groupe/ligne inconnu", () => {
    expect(moveNavRowBefore(base(), "/console", "Télévente", "/console")).toEqual(base());
    expect(moveNavRowBefore(base(), "/console", "Zone inconnue", null)).toEqual(base());
    expect(moveNavRowBefore(base(), "/inconnu", "Entrepôt", null)).toEqual(base());
  });

  it("échange deux lignes de groupes différents (« remplace »)", () => {
    const next = swapNavRows(base(), "/console", "/livraisons");
    expect(hrefs(next, "Télévente")).toEqual(["/livraisons", "/clients"]);
    expect(hrefs(next, "Entrepôt")).toEqual(["/console"]);
  });

  it("échange deux lignes du même groupe", () => {
    const next = swapNavRows(base(), "/console", "/clients");
    expect(hrefs(next, "Télévente")).toEqual(["/clients", "/console"]);
  });
});
