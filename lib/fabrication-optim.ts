/**
 * Optimiseur de transformation — fonctions PURES (zéro I/O), testées par
 * lib/fabrication-optim.test.ts.
 *
 * Problème métier : « j'ai 10 colis de 4 kg (= 40 kg) ; je veux des colis de
 * 5 kg → 8 colis pile. Et si je vise des colis de 6 kg ? → 6 colis (36 kg,
 * reste 4 kg) OU 7 colis (42 kg, manque 2 kg). »
 * Le système propose les scénarios triés par MOINDRE ÉCART (défaut métier),
 * avec les 4 chiffres clés : utilisé / restant / manquant / perte.
 *
 * ⚠️ Unité de gestion RÉELLE — ne JAMAIS supposer le kg :
 *   • article au poids (SalesUnit kg) → on raisonne en kg
 *     (poids d'un colis = salesUnitWeight × salesQtyPerPackUnit × (salesItemsPerUnit ?? 1)) ;
 *   • article au colis / à la barquette → on raisonne directement dans cette
 *     unité (1 colis = 1 unité de gestion).
 *   Côté affichage, la règle Gervifrais reste « tout en colis » : on n'affiche
 *   jamais pièce — la barquette n'apparaît que si elle EST l'unité réelle.
 */

const r3 = (n: number) => Math.round(n * 1000) / 1000;
const EPS = 1e-9;

// ── Unité de gestion réelle d'un article ──────────────────────────────

export type UniteGestion = {
  /** Mot de comptage des colis : "colis" (défaut) ou "barquette" si c'est l'unité réelle. */
  uniteColis: string;
  /** Unité de la quantité physique : "kg" si géré au poids, sinon = uniteColis. */
  unitePhysique: string;
  /** Quantité physique par colis (kg/colis si au poids, 1 sinon). */
  physParColis: number;
  /** true si l'article est géré au poids (SalesUnit kg/kilo). */
  auPoids: boolean;
};

/**
 * Détermine l'unité de gestion réelle d'un article (champs Product).
 *   • SalesUnit kg/kilo → au poids : physParColis =
 *     salesUnitWeight × salesQtyPerPackUnit × (salesItemsPerUnit ?? 1).
 *   • Sinon → l'unité de gestion EST le colis (physParColis = 1) ; on n'affiche
 *     « barquette » que si l'unité SAP réelle est une barquette NON regroupée
 *     en colis (salesQtyPerPackUnit ≤ 1).
 */
export function uniteGestion(p: {
  salesUnit?: string | null;
  inventoryUnit?: string | null;
  salesUnitWeight?: number | null;
  salesQtyPerPackUnit?: number | null;
  salesItemsPerUnit?: number | null;
}): UniteGestion {
  const brut = (p.salesUnit ?? "").trim() || (p.inventoryUnit ?? "").trim();
  if (/kg|kilo/i.test(brut)) {
    const poidsPie = p.salesUnitWeight && p.salesUnitWeight > 0 ? p.salesUnitWeight : 1;
    const salPackUn = p.salesQtyPerPackUnit && p.salesQtyPerPackUnit > 0 ? p.salesQtyPerPackUnit : 1;
    const numInSale = p.salesItemsPerUnit && p.salesItemsPerUnit > 0 ? p.salesItemsPerUnit : 1;
    return {
      uniteColis: "colis",
      unitePhysique: "kg",
      physParColis: r3(poidsPie * salPackUn * numInSale),
      auPoids: true,
    };
  }
  // Pas au poids : unité de gestion = le colis. Barquette UNIQUEMENT si c'est
  // l'unité réelle (pas de regroupement en colis) — jamais « pièce ».
  const regroupe = (p.salesQtyPerPackUnit ?? 0) > 1;
  const uniteColis = !regroupe && /barq|bqt/i.test(brut) ? "barquette" : "colis";
  return { uniteColis, unitePhysique: uniteColis, physParColis: 1, auPoids: false };
}

/** Quantité physique (unité de gestion) correspondant à `nbColis` colis. */
export function quantitePhysique(nbColis: number, u: UniteGestion): number {
  return r3(nbColis * u.physParColis);
}

// ── Unité de BASE d'un article (recettes v3 en unités) ────────────────

/** Familles fruits rouges (lib/familles) — vendues en barquettes regroupées en colis. */
export const FRUIT_FAMILY_KEYS = new Set(["myrtille", "groseille", "framboise", "cassis", "mure", "fraise"]);

/**
 * Mot de comptage de l'UNITÉ DE BASE d'un article — celle des quantités
 * d'inventaire SAP et des recettes v3 (« 6 barquettes groseille ») :
 *   • article au poids → "kg" ;
 *   • SalesUnit/InventoryUnit barquette (barq/bqt) → "barquette" ;
 *   • famille fruits rouges (SAP dit souvent "pie") → "barquette" aussi ;
 *   • sinon → "unité" (jamais « pièce », règle Gervifrais).
 * Différent de `uniteGestion` (qui compte les COLIS) : ici on nomme ce qu'il
 * y a DANS le colis.
 */
export function uniteBase(p: {
  salesUnit?: string | null;
  inventoryUnit?: string | null;
  familyKey?: string | null;
}): string {
  const brut = `${p.salesUnit ?? ""} ${p.inventoryUnit ?? ""}`;
  if (/kg|kilo/i.test(brut)) return "kg";
  if (/barq|bqt/i.test(brut)) return "barquette";
  if (p.familyKey && FRUIT_FAMILY_KEYS.has(p.familyKey)) return "barquette";
  return "unité";
}

/** Mode d'expression d'une ligne de recette : unités de base (v3) ou colis (legacy v2). */
export type ModeQuantite = "unite" | "colis";

/**
 * Quantités d'un composant pour un run — SOURCE UNIQUE de la conversion
 * unités ↔ colis (serveur /api/sap/assembly ET client FabriquerPanel) :
 *   • mode "unite" : pieceQty = qty × tours (unités de base = quantité SAP),
 *     colisQty = pieceQty / ratio — peut être FRACTIONNAIRE (0,5 colis =
 *     6 barquettes d'un colis de 12) : c'est le but de la v3, entamer des colis.
 *   • mode "colis" : colisQty = qty × tours, pieceQty = colisQty × ratio (v2).
 * `ratio` = packRatio de l'article choisi (unités de base par colis, kg → 1).
 */
export function quantitesComposant(
  qty: number,
  mode: ModeQuantite,
  tours: number,
  ratio: number,
): { pieceQty: number; colisQty: number } {
  const r = ratio > 0 ? ratio : 1;
  if (mode === "unite") {
    const pieceQty = r3(qty * tours);
    return { pieceQty, colisQty: r3(pieceQty / r) };
  }
  const colisQty = r3(qty * tours);
  return { pieceQty: r3(colisQty * r), colisQty };
}

/** Libellé d'unité accordé : kg/colis invariables, barquette·s à partir de 2. */
export function libelleUnite(unite: string, n = 1): string {
  if (unite === "kg" || unite === "colis") return unite;
  return Math.abs(n) >= 2 ? `${unite}s` : unite;
}

// ── Répartition de l'ENTRÉE du produit fini (couverture du découvert) ──

export type LigneEntreeFabrication = {
  warehouseCode: string;
  /** Quantité en unités de base (quantité SAP). */
  quantity: number;
  /** true si cette ligne COMBLE un stock négatif (vente à découvert). */
  couvreDecouvert: boolean;
};

/**
 * Répartit l'entrée du produit fini d'une fabrication entre magasins :
 * si le produit est À DÉCOUVERT ailleurs (dispo < 0 — vendu avant d'être
 * fabriqué), la production comble ces découverts D'ABORD (ordre 000, 01, R1),
 * et seul le RESTE entre dans le magasin d'entrée choisi. Ainsi le stock
 * négatif est régularisé par la fabrication elle-même — plus besoin d'aller
 * corriger le magasin dans SAP après coup.
 *
 *   repartitionEntree(4, "01", { "000": -2 })
 *     → [{ warehouseCode: "000", quantity: 2, couvreDecouvert: true },
 *        { warehouseCode: "01",  quantity: 2, couvreDecouvert: false }]
 *
 * Le magasin d'entrée lui-même n'est jamais listé comme découvert : y entrer
 * la production le régularise déjà. Si les découverts absorbent toute la
 * production, le magasin d'entrée ne reçoit rien (ligne omise).
 */
export function repartitionEntree(
  totalQty: number,
  entryWarehouse: string,
  dispoByWhs: Record<string, number>,
  ordre: readonly string[] = ["000", "01", "R1"],
): LigneEntreeFabrication[] {
  if (!Number.isFinite(totalQty) || totalQty <= 0) return [];
  const lines: LigneEntreeFabrication[] = [];
  let remaining = r3(totalQty);
  for (const whs of ordre) {
    if (whs === entryWarehouse) continue;
    const deficit = r3(-(dispoByWhs[whs] ?? 0));
    if (deficit <= EPS) continue;
    const take = r3(Math.min(remaining, deficit));
    if (take <= EPS) continue;
    lines.push({ warehouseCode: whs, quantity: take, couvreDecouvert: true });
    remaining = r3(remaining - take);
    if (remaining <= EPS) break;
  }
  if (remaining > EPS) {
    lines.push({ warehouseCode: entryWarehouse, quantity: remaining, couvreDecouvert: false });
  }
  return lines;
}

// ── Scénarios de transformation ───────────────────────────────────────

export type ScenarioTransformation = {
  /** Nombre de colis CIBLES produits (multiple de `pas`). */
  nbColis: number;
  /** Quantité physique nécessaire pour ces colis (= nbColis × cible). */
  quantiteNecessaire: number;
  /** Quantité réellement consommée (= min(nécessaire, disponible)). */
  quantiteUtilisee: number;
  /** Quantité disponible NON consommée (revendable telle quelle). */
  reste: number;
  /** Quantité qu'il faudrait EN PLUS du disponible (scénario « au-dessus »). */
  manque: number;
  /** Entame de colis source ouvert mais non utilisé (si colisSource fourni). */
  perte: number;
  /** |nécessaire − disponible| — critère de tri (moindre écart d'abord). */
  ecart: number;
  /** true si la transformation tombe juste (reste = manque = 0). */
  exact: boolean;
  /** true sur le scénario au moindre écart (1er de la liste). */
  recommande: boolean;
};

/**
 * Propose les meilleurs scénarios de transformation d'une quantité disponible
 * vers un conditionnement cible, triés par écart absolu croissant.
 *
 *   scenariosTransformation({ disponible: 40, cible: 5 })
 *     → [{ nbColis: 8, quantiteUtilisee: 40, reste: 0, manque: 0, exact: true }, …]
 *   scenariosTransformation({ disponible: 40, cible: 6 })
 *     → [{ nbColis: 7, quantiteUtilisee: 40, manque: 2 },   // moindre écart → recommandé
 *        { nbColis: 6, quantiteUtilisee: 36, reste: 4 }, …]
 *
 * Toujours les 2 encadrants (floor/ceil) au minimum quand ça ne tombe pas
 * juste, plus les voisins ±1 pas si pertinents (cap `maxScenarios`).
 * Cas limites : cible ≤ 0 ou disponible ≤ 0 → [] ; cible > disponible → le
 * scénario « 1 pas » avec son manque (jamais de scénario à 0 colis).
 */
export function scenariosTransformation(opts: {
  /** Quantité physique disponible, dans l'unité de gestion réelle. */
  disponible: number;
  /** Conditionnement cible (taille d'un colis cible, MÊME unité). */
  cible: number;
  /** Taille d'un colis SOURCE (même unité) — active le calcul de perte (entames). */
  colisSource?: number | null;
  /** nbColis doit être multiple de ce pas (ex. parentQty d'une recette). Défaut 1. */
  pas?: number;
  /** Nombre maxi de scénarios renvoyés. Défaut 4. */
  maxScenarios?: number;
}): ScenarioTransformation[] {
  const dispo = r3(opts.disponible);
  const cible = r3(opts.cible);
  if (!Number.isFinite(dispo) || !Number.isFinite(cible) || dispo <= 0 || cible <= 0) return [];
  const pas = opts.pas && Number.isFinite(opts.pas) && opts.pas >= 1 ? Math.round(opts.pas) : 1;
  const max = opts.maxScenarios && opts.maxScenarios > 0 ? opts.maxScenarios : 4;
  const colisSource = opts.colisSource && opts.colisSource > 0 ? r3(opts.colisSource) : null;

  const brut = dispo / cible / pas;
  const floorN = Math.floor(brut + EPS) * pas;
  const ceilN = Math.ceil(brut - EPS) * pas;

  // Encadrants + voisins ±1 pas (si pertinents), jamais 0 colis.
  const candidats = Array.from(new Set([floorN, ceilN, floorN - pas, ceilN + pas]))
    .filter((n) => n >= pas);

  const scenarios = candidats.map((nbColis) => {
    const necessaire = r3(nbColis * cible);
    const manque = r3(Math.max(0, necessaire - dispo));
    const utilisee = r3(Math.min(necessaire, dispo));
    let reste = r3(Math.max(0, dispo - necessaire));
    let perte = 0;
    // Perte = entame : pour sortir `utilisee`, on ouvre ⌈utilisee/colisSource⌉
    // colis source ; ce qui dépasse de l'entamé est perdu (colis ouvert).
    if (colisSource != null && manque === 0 && utilisee > 0) {
      const entames = Math.ceil(utilisee / colisSource - EPS);
      const consomme = Math.min(dispo, r3(entames * colisSource));
      perte = r3(Math.max(0, consomme - utilisee));
      reste = r3(Math.max(0, dispo - utilisee - perte));
    }
    const ecart = r3(Math.abs(necessaire - dispo));
    return {
      nbColis,
      quantiteNecessaire: necessaire,
      quantiteUtilisee: utilisee,
      reste,
      manque,
      perte,
      ecart,
      exact: ecart === 0,
      recommande: false,
    };
  });

  // Moindre écart d'abord ; à écart égal, on préfère NE PAS manquer de
  // marchandise (floor avant ceil), puis le plus petit nombre de colis.
  scenarios.sort((a, b) =>
    a.ecart - b.ecart || (a.manque > 0 ? 1 : 0) - (b.manque > 0 ? 1 : 0) || a.nbColis - b.nbColis,
  );
  const out = scenarios.slice(0, max);
  if (out.length > 0) out[0] = { ...out[0], recommande: true };
  return out;
}
