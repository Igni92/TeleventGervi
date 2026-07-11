import { describe, it, expect } from "vitest";
import { selectCarryoverEntries, type CarryoverStatuses } from "./livraisonCarryover";

/** Fabrique un jeu de statuts vide, complété par docEntry. */
function makeStatuses(entries: Record<number, {
  misEnPrep?: boolean;
  prepared?: boolean;
  departed?: boolean;
  excluded?: boolean;
  misEnPrepAt?: string;
}>): CarryoverStatuses {
  const s: CarryoverStatuses = {
    misEnPrep: new Map(),
    prepared: new Map(),
    departed: new Map(),
    excluded: new Map(),
    misEnPrepAt: new Map(),
  };
  for (const [k, v] of Object.entries(entries)) {
    const de = Number(k);
    if (v.misEnPrep !== undefined) s.misEnPrep.set(de, v.misEnPrep);
    if (v.prepared !== undefined) s.prepared.set(de, v.prepared);
    if (v.departed !== undefined) s.departed.set(de, v.departed);
    if (v.excluded !== undefined) s.excluded.set(de, v.excluded);
    if (v.misEnPrepAt !== undefined) s.misEnPrepAt.set(de, v.misEnPrepAt);
  }
  return s;
}

describe("selectCarryoverEntries — report de la file de préparation", () => {
  it("reporte une prépa NON FAITE d'un jour passé (retard → jour suivant)", () => {
    // Due le 10, mise en prépa le 10, pas encore faite. Vue du 11 (jour suivant).
    const s = makeStatuses({ 100: { misEnPrep: true, misEnPrepAt: "2026-07-10T08:00:00Z" } });
    expect(selectCarryoverEntries(s, "2026-07-11", new Set())).toEqual([100]);
  });

  it("reporte une prépa ANTICIPÉE (mise le 10 pour une livraison le 15) chaque jour d'ici là", () => {
    // Due le 15, mise en prépa le 10. Visible du 10 au 14 (le 15 elle y est par sa date).
    const s = makeStatuses({ 200: { misEnPrep: true, misEnPrepAt: "2026-07-10T09:30:00Z" } });
    for (const day of ["2026-07-10", "2026-07-11", "2026-07-12", "2026-07-13", "2026-07-14"]) {
      expect(selectCarryoverEntries(s, day, new Set())).toEqual([200]);
    }
  });

  it("ne reporte PAS une commande déjà présente dans la vue du jour (dédup)", () => {
    const s = makeStatuses({ 300: { misEnPrep: true, misEnPrepAt: "2026-07-10T08:00:00Z" } });
    expect(selectCarryoverEntries(s, "2026-07-11", new Set([300]))).toEqual([]);
  });

  it("ne reporte PAS une commande FAITE ou PARTIE", () => {
    const s = makeStatuses({
      400: { misEnPrep: true, prepared: true, misEnPrepAt: "2026-07-10T08:00:00Z" },
      401: { misEnPrep: true, departed: true, misEnPrepAt: "2026-07-10T08:00:00Z" },
    });
    expect(selectCarryoverEntries(s, "2026-07-11", new Set())).toEqual([]);
  });

  it("ne reporte PAS une commande NON mise en préparation (misEnPrep faux/absent)", () => {
    const s = makeStatuses({
      500: { misEnPrep: false, misEnPrepAt: "2026-07-10T08:00:00Z" }, // basculée puis retirée
      501: { prepared: false }, // jamais mise en prépa (pas d'entrée misEnPrep)
    });
    expect(selectCarryoverEntries(s, "2026-07-11", new Set())).toEqual([]);
  });

  it("ne reporte PAS une commande exclue (avoir manuel)", () => {
    const s = makeStatuses({ 600: { misEnPrep: true, excluded: true, misEnPrepAt: "2026-07-10T08:00:00Z" } });
    expect(selectCarryoverEntries(s, "2026-07-11", new Set())).toEqual([]);
  });

  it("ne fait PAS remonter une prépa dans un passé antérieur à sa mise à disposition", () => {
    // Mise à dispo le 10 : invisible dans la vue du 9 (et avant).
    const s = makeStatuses({ 700: { misEnPrep: true, misEnPrepAt: "2026-07-10T08:00:00Z" } });
    expect(selectCarryoverEntries(s, "2026-07-09", new Set())).toEqual([]);
    // Le jour même de la mise à dispo, elle est bien reportée.
    expect(selectCarryoverEntries(s, "2026-07-10", new Set())).toEqual([700]);
  });

  it("inclut une prépa sans horodatage de mise à disposition (repli sûr)", () => {
    const s = makeStatuses({ 800: { misEnPrep: true } });
    expect(selectCarryoverEntries(s, "2026-07-11", new Set())).toEqual([800]);
  });

  it("reporte une commande dé-préparée (prepared=false explicite) — toujours à préparer", () => {
    // prepared=false explicite (marquée puis démarquée) → toujours à préparer → reportée.
    const s = makeStatuses({ 900: { misEnPrep: true, prepared: false, misEnPrepAt: "2026-07-10T08:00:00Z" } });
    expect(selectCarryoverEntries(s, "2026-07-11", new Set())).toEqual([900]);
  });

  it("sélectionne plusieurs prépas et respecte tous les filtres à la fois", () => {
    const s = makeStatuses({
      1: { misEnPrep: true, misEnPrepAt: "2026-07-08T08:00:00Z" },                 // retard → reporté
      2: { misEnPrep: true, misEnPrepAt: "2026-07-10T08:00:00Z" },                 // anticipé → reporté
      3: { misEnPrep: true, prepared: true, misEnPrepAt: "2026-07-08T08:00:00Z" }, // faite → non
      4: { misEnPrep: true, misEnPrepAt: "2026-07-20T08:00:00Z" },                 // dispo future → non (vue du 11)
      5: { misEnPrep: false, misEnPrepAt: "2026-07-08T08:00:00Z" },                // retirée → non
    });
    expect(selectCarryoverEntries(s, "2026-07-11", new Set([1])).sort()).toEqual([2]);
    expect(selectCarryoverEntries(s, "2026-07-11", new Set()).sort()).toEqual([1, 2]);
  });
});
