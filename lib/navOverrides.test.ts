import { describe, it, expect } from "vitest";
import {
  applyNavOverrides, sanitizeNavOverrides, toEditState, fromEditState,
  moveNavRowBefore, swapNavRows,
  applyNavConfig, toNavConfig, toNavEditState, fromNavEditState, sanitizeNavCategories,
  addNavCategory, addNavSubCategory, renameNavCategory, deleteNavCategory, moveNavCategory,
  type NavOverrides, type NavConfig,
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

describe("navOverrides — config { items, categories }", () => {
  const EMPTY: NavConfig = { items: {}, categories: [] };
  const hrefsOf = (out: ReturnType<typeof applyNavConfig>, label: string) =>
    out.find((g) => g.label === label)?.items.map((i) => i.href) ?? null;

  it("config vide → même structure que par défaut (Accueil + groupes d'origine)", () => {
    const out = applyNavConfig(GROUPS, EMPTY);
    expect(out.map((g) => g.label)).toEqual([null, "Télévente", "Entrepôt"]);
    expect(hrefsOf(out, "Télévente")).toEqual(["/console", "/clients"]);
    expect(out.every((g) => !g.parent)).toBe(true);
  });

  it("toNavConfig lit l'ANCIEN format nu (surcharges d'items) comme categories vide", () => {
    const legacy = { "/console": { label: "Téléphone", order: 0 } };
    expect(toNavConfig(legacy)).toEqual({ items: { "/console": { label: "Téléphone", order: 0 } }, categories: [] });
  });

  it("catégorie CRÉÉE + entrée déplacée dedans → rendue à sa place", () => {
    const config: NavConfig = {
      items: { "/clients": { group: "Ma catégorie", order: 0 } },
      categories: [{ label: "Ma catégorie", order: 5 }],
    };
    const out = applyNavConfig(GROUPS, config);
    expect(hrefsOf(out, "Ma catégorie")).toEqual(["/clients"]);
    expect(hrefsOf(out, "Télévente")).toEqual(["/console"]);   // /clients parti
  });

  it("catégorie créée mais VIDE → absente du rendu, mais présente à l'édition", () => {
    const config: NavConfig = { items: {}, categories: [{ label: "Vide", order: 9 }] };
    expect(applyNavConfig(GROUPS, config).some((g) => g.label === "Vide")).toBe(false);
    expect(toNavEditState(GROUPS, config).some((g) => g.label === "Vide" && g.custom)).toBe(true);
  });

  it("sous-catégorie : entrée dedans, parent porté ; parent vide reste s'il a un enfant visible", () => {
    const config: NavConfig = {
      items: { "/livraisons": { group: "Tournées", order: 0 } },
      categories: [
        { label: "Logistique", order: 3 },
        { label: "Tournées", parent: "Logistique", order: 0 },
      ],
    };
    const out = applyNavConfig(GROUPS, config);
    const logi = out.find((g) => g.label === "Logistique");
    const tour = out.find((g) => g.label === "Tournées");
    expect(logi).toBeTruthy();                 // en-tête conservé
    expect(logi!.items).toEqual([]);           // parent sans entrée directe
    expect(tour?.parent).toBe("Logistique");   // rendu indenté
    expect(tour?.items.map((i) => i.href)).toEqual(["/livraisons"]);
  });

  it("aller-retour édition : fromNavEditState(toNavEditState) reproduit le rendu", () => {
    const config: NavConfig = {
      items: { "/clients": { group: "Ventes+", order: 0 }, "/console": { order: 1 } },
      categories: [{ label: "Ventes+", parent: "Télévente", order: 0 }],
    };
    const round = fromNavEditState(toNavEditState(GROUPS, config));
    expect(applyNavConfig(GROUPS, round)).toEqual(applyNavConfig(GROUPS, config));
  });
});

describe("navOverrides — opérations de catégorie", () => {
  const base = () => toNavEditState(GROUPS, { items: {}, categories: [] });
  const labels = (s: ReturnType<typeof base>) => s.map((g) => g.label);

  it("addNavCategory ajoute une catégorie custom vide, libellé unique", () => {
    const s1 = addNavCategory(base(), "Promos");
    expect(labels(s1)).toContain("Promos");
    const s2 = addNavCategory(s1, "Promos");
    expect(labels(s2).filter((l) => l.startsWith("Promos"))).toEqual(["Promos", "Promos 2"]);
    expect(s1.find((g) => g.label === "Promos")).toMatchObject({ custom: true, parent: null, rows: [] });
  });

  it("addNavSubCategory insère une sous-cat juste après le parent ; refuse sous une sous-cat", () => {
    let s = addNavCategory(base(), "Logistique");
    s = addNavSubCategory(s, "Logistique", "Tournées");
    const i = labels(s).indexOf("Logistique");
    expect(labels(s)[i + 1]).toBe("Tournées");
    expect(s.find((g) => g.label === "Tournées")).toMatchObject({ parent: "Logistique", custom: true });
    // pas de 2e niveau
    const s2 = addNavSubCategory(s, "Tournées", "Sous-sous");
    expect(s2.some((g) => g.parent === "Tournées")).toBe(false);
  });

  it("renameNavCategory met à jour le parent des sous-catégories", () => {
    let s = addNavCategory(base(), "Logistique");
    s = addNavSubCategory(s, "Logistique", "Tournées");
    s = renameNavCategory(s, "Logistique", "Dépôt");
    expect(labels(s)).toContain("Dépôt");
    expect(s.find((g) => g.label === "Tournées")!.parent).toBe("Dépôt");
  });

  it("deleteNavCategory : seulement si vide et sans sous-catégorie", () => {
    let s = addNavCategory(base(), "Vide");
    expect(deleteNavCategory(s, "Vide").some((g) => g.label === "Vide")).toBe(false);
    // non vide → refus
    s = addNavCategory(base(), "Pleine");
    s = moveNavRowBefore(s, "/console", "Pleine", null);
    expect(deleteNavCategory(s, "Pleine").some((g) => g.label === "Pleine")).toBe(true); // a une entrée → conservé
  });

  it("moveNavCategory déplace le bloc (catégorie + ses sous-catégories)", () => {
    let s = addNavCategory(base(), "A");
    s = addNavSubCategory(s, "A", "A1");
    s = addNavCategory(s, "B");
    // A (+A1) puis B, en fin ; remonter B d'un cran passe devant A
    const before = labels(s);
    const iA = before.indexOf("A"), iB = before.indexOf("B");
    expect(iB).toBe(iA + 2);               // A, A1, B
    const moved = moveNavCategory(s, "B", -1);
    expect(labels(moved)).toEqual([...labels(base()), "B", "A", "A1"]);
  });
});

describe("navOverrides — sanitizeNavCategories", () => {
  it("libellés uniques/bornés, parent inexistant retiré, une seule profondeur", () => {
    const raw = [
      { label: "  Logistique  ", order: 2.6 },
      { label: "Tournées", parent: "Logistique" },
      { label: "Détail", parent: "Tournées" },   // parent est une sous-cat → aplati
      { label: "Orpheline", parent: "Fantôme" }, // parent inexistant → retiré
      { label: "Logistique" },                     // doublon → ignoré
      "nope",                                       // non-objet → ignoré
    ];
    const out = sanitizeNavCategories(raw);
    expect(out.find((c) => c.label === "Logistique")).toEqual({ label: "Logistique", order: 3 });
    expect(out.find((c) => c.label === "Tournées")!.parent).toBe("Logistique");
    expect(out.find((c) => c.label === "Détail")!.parent).toBeUndefined();
    expect(out.find((c) => c.label === "Orpheline")!.parent).toBeUndefined();
    expect(out.filter((c) => c.label === "Logistique")).toHaveLength(1);
  });
});
