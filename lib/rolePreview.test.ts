import { describe, it, expect } from "vitest";
import { navAllowedForPreview, previewRoleForPerson, previewHome } from "./rolePreview";

describe("navAllowedForPreview", () => {
  it("sans rôle prévisualisé → tout est visible", () => {
    expect(navAllowedForPreview("/console", null)).toBe(true);
    expect(navAllowedForPreview("/parametres", null)).toBe(true);
  });

  it("préparateur → uniquement Détail livraison + Inventaire", () => {
    expect(navAllowedForPreview("/livraisons", "preparateur")).toBe(true);
    expect(navAllowedForPreview("/inventaire", "preparateur")).toBe(true);
    expect(navAllowedForPreview("/console", "preparateur")).toBe(false);
    expect(navAllowedForPreview("/clients", "preparateur")).toBe(false);
  });

  it("commercial / direction → app complète", () => {
    expect(navAllowedForPreview("/console", "commercial")).toBe(true);
    expect(navAllowedForPreview("/parametres", "direction")).toBe(true);
  });
});

describe("previewRoleForPerson — rôle effectif vu par la personne", () => {
  it("préparateur accès restreint (verrouillé) → preparateur, quel que soit le reste", () => {
    expect(previewRoleForPerson({ restrictedPreparateur: true, isCommercial: true })).toBe("preparateur");
    expect(previewRoleForPerson({ restrictedPreparateur: true, isAdmin: true })).toBe("preparateur");
  });

  it("admin ou direction → direction (vue complète)", () => {
    expect(previewRoleForPerson({ isAdmin: true })).toBe("direction");
    expect(previewRoleForPerson({ isDirection: true, isCommercial: true })).toBe("direction");
  });

  it("préparateur pur (sans casquette commerciale) → preparateur", () => {
    expect(previewRoleForPerson({ isPreparateur: true, isCommercial: false })).toBe("preparateur");
  });

  it("commercial + préparateur (non restreint) → commercial (vue complète réelle)", () => {
    expect(previewRoleForPerson({ isPreparateur: true, isCommercial: true })).toBe("commercial");
  });

  it("commercial simple → commercial", () => {
    expect(previewRoleForPerson({ isCommercial: true })).toBe("commercial");
  });
});

describe("previewHome", () => {
  it("préparateur atterrit sur le Détail livraison, les autres sur l'accueil", () => {
    expect(previewHome("preparateur")).toBe("/livraisons");
    expect(previewHome("commercial")).toBe("/accueil");
    expect(previewHome("direction")).toBe("/accueil");
  });
});
