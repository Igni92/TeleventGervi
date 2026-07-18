/**
 * Fonctions PURES de calcul Gervifrais (testables, sans I/O).
 * Centralise la logique financière critique : découpe entrepôts, TPF, prix conseillé.
 * Couvert par lib/gervifrais-calc.test.ts.
 */

// ── Découpe multi-entrepôt ────────────────────────────────────
export const WAREHOUSE_FILL_ORDER = ["000", "01", "R1"];

/** Magasin d'ATTENTE des quantités vendues à découvert (000 = « A/C - A/D »).
 *  La ligne y stationne sans lot (EM_PENDING) jusqu'à la réception, qui pose le
 *  vrai lot ET déplace la ligne vers le magasin de réception (receiptRetro). */
export const DECOUVERT_WAREHOUSE = "000";

export type WarehouseChunk = {
  warehouse: string;
  qty: number;
  /** true = quantité SANS stock (sur-vente) : part sur sa propre ligne, sans
   *  lot EM — jamais fusionnée avec une ligne de stock (sinon le magasin de la
   *  ligne passe en négatif et la réception ne peut plus la corriger). */
  decouvert?: boolean;
};

export function totalAvailable(availByWarehouse: Record<string, number>): number {
  return WAREHOUSE_FILL_ORDER.reduce((s, w) => s + Math.max(0, availByWarehouse[w] ?? 0), 0);
}

/** Répartit une quantité sur les entrepôts par ordre de puisage (000→01→R1).
 *  Le surplus (sur-vente) part sur un chunk SÉPARÉ marqué `decouvert` (magasin
 *  d'attente 000) : la quantité en stock garde son magasin + son lot, le reste
 *  attend la réception sans lot. */
export function splitByWarehouse(
  qty: number,
  availByWarehouse: Record<string, number>,
  fillOrder: string[] = WAREHOUSE_FILL_ORDER,
): WarehouseChunk[] {
  let remaining = qty;
  const chunks: WarehouseChunk[] = [];
  for (const w of fillOrder) {
    if (remaining <= 0.0001) break;
    const avail = Math.max(0, availByWarehouse[w] ?? 0);
    if (avail <= 0) continue;
    const take = Math.min(avail, remaining);
    chunks.push({ warehouse: w, qty: Math.round(take * 1000) / 1000 });
    remaining -= take;
  }
  if (remaining > 0.0001) {
    chunks.push({
      warehouse: DECOUVERT_WAREHOUSE,
      qty: Math.round(remaining * 1000) / 1000,
      decouvert: true,
    });
  }
  return chunks;
}

const r2 = (n: number) => Math.round(n * 100) / 100;

// ── Taxes para-fiscales (TPF) ─────────────────────────────────
/** TPF2 INTERFEL = LineHT × taux% (taux par défaut 0,21). */
export function computeItfel(lineHT: number, tauxPct = 0.21): number {
  if (lineHT <= 0) return 0;
  return r2(lineHT * (tauxPct / 100));
}
/** TPF3 DROIT DE GARDE = nb_colis × taux €/colis (défaut 0,02). */
export function computeDdg(nbColis: number, tauxParColis = 0.02): number {
  if (nbColis <= 0) return 0;
  return r2(nbColis * tauxParColis);
}

// ── Prix conseillé ────────────────────────────────────────────
export const COEF_DEFAUT = 1.5;

export type PriceCategory =
  | "Fraises" | "Fruits_Rges" | "Legumes" | "Fruits_Prep"
  | "Divers_Fruits" | "Fruits_Secs" | "Autres";

export function categoryFromGroupName(name?: string | null): PriceCategory | null {
  if (!name) return null;
  const n = name.toLowerCase();
  if (/fraise/.test(n)) return "Fraises";
  if (/fruits?\s*rouges?|framboise|myrtille|m[uû]re|groseille|cassis/.test(n)) return "Fruits_Rges";
  if (/l[ée]gume/.test(n)) return "Legumes";
  if (/pr[ée]par/.test(n)) return "Fruits_Prep";
  if (/secs?|amande|datte|noix|noisette|pruneau/.test(n)) return "Fruits_Secs";
  if (/agrume|exotiqu|banane|ananas|mangue|kiwi|raisin|pomme|poire|p[êe]che|prune|cerise|figue|melon|brugnon|nectarine/.test(n)) return "Divers_Fruits";
  return null;
}

export interface GroupCoefs {
  base: Partial<Record<PriceCategory, number>>;
  fraiseBands?: { b0_3?: number; b3_5?: number; b5_8?: number; b8_999?: number };
}

export function fraiseBandCoef(bands: GroupCoefs["fraiseBands"], achat: number): number | undefined {
  if (!bands) return undefined;
  if (achat < 3) return bands.b0_3 || undefined;
  if (achat < 5) return bands.b3_5 || undefined;
  if (achat < 8) return bands.b5_8 || undefined;
  return bands.b8_999 || undefined;
}

/** Coefficient applicable (spécifique groupe×catégorie, paliers fraises, sinon défaut 1,5). */
export function resolveCoef(category: PriceCategory | null, coefs: GroupCoefs, achat: number): { coef: number; isDefault: boolean } {
  let coef: number | undefined;
  if (category === "Fraises") coef = fraiseBandCoef(coefs.fraiseBands, achat) ?? coefs.base.Fraises;
  else if (category) coef = coefs.base[category];
  if (coef == null || coef === 0) return { coef: COEF_DEFAUT, isDefault: true };
  return { coef, isDefault: false };
}

export function computeSuggestedPrice(achat: number, coef: number): number {
  return r2(achat * coef);
}

// ── Numéro de lot (U_NoLot) ───────────────────────────────────
/**
 * Sentinel de vente à découvert : un BL créé sans lot résolvable porte ce code.
 * /api/sap/goods-receipts le réécrit en EM<DocNum> à la prochaine entrée
 * marchandise. Défini ICI (lib pure, testable) et ré-exporté par lib/lotResolver
 * pour les consommateurs existants. ⚠️ Libellé ASCII court (PATCH SAP U_NoLot).
 */
export const LOT_PENDING = "EM_PENDING";

/**
 * Sentinel « produit / famille » d'un bon de commande : la ligne attend un lot
 * d'un FRUIT donné (fraise, framboise…), à préciser À LA MAIN quand la
 * marchandise arrive. Parallèle de LOT_PENDING (à découvert générique) mais
 * porte l'INTENTION — quel fruit servira la ligne.
 *
 * ⚠️ Différence clé avec LOT_PENDING : /api/sap/goods-receipts ne réécrit QUE
 * les lignes strictement égales à LOT_PENDING. Un sentinel famille n'est donc
 * JAMAIS résolu automatiquement — c'est un RAPPEL, l'utilisateur choisit le vrai
 * lot dans l'onglet « Bons de commande ». Format : `EM_FAM:<cléFamille>`
 * (ASCII court, cf. FRUIT_FAMILIES de lib/familles). Ex. `EM_FAM:fraise`.
 */
export const LOT_FAMILY_PREFIX = "EM_FAM:";

/** Construit le sentinel famille à poser dans U_NoLot (clé cf. FRUIT_FAMILIES). */
export function familyLotSentinel(familyKey: string): string {
  return LOT_FAMILY_PREFIX + (familyKey ?? "").trim().toLowerCase();
}

/** Extrait la clé de famille d'un U_NoLot, ou null si ce n'est pas un sentinel
 *  famille (vrai EM<DocNum>, EM_PENDING, vide…). */
export function familyOfLot(lot: string | null | undefined): string | null {
  const s = (lot ?? "").trim();
  if (!s.startsWith(LOT_FAMILY_PREFIX)) return null;
  const key = s.slice(LOT_FAMILY_PREFIX.length).trim().toLowerCase();
  return key || null;
}

/** Une ligne est-elle EN ATTENTE de lot ? Vide, EM_PENDING (à découvert) ou
 *  sentinel famille (produit à préciser). Un vrai `EM<DocNum>` = résolu. */
export function isLotPending(lot: string | null | undefined): boolean {
  const s = (lot ?? "").trim();
  return s === "" || s === LOT_PENDING || s.startsWith(LOT_FAMILY_PREFIX);
}

/** Un VRAI lot suivi au registre :
 *   • `EM<DocNum>`  — lot d'une entrée marchandise (réception) ;
 *   • `OP<NNNNN>`   — lot d'un ordre de production (produit FABRIQUÉ, cf. /assembly).
 *  Exclut les sentinels d'attente (EM_PENDING, EM_FAM:<fruit>) et tout le reste.
 *  Sert au registre des lots : crédit/débit ne visent que les vrais lots, et un
 *  produit fabriqué doit être suivi par lot au même titre qu'un article reçu. */
export function isRealLot(lot: string | null | undefined): boolean {
  const s = (lot ?? "").trim();
  if (!s || isLotPending(s)) return false;
  return /^(EM|OP)\d+$/i.test(s);
}

// ── Écrêtage du registre des lots au stock physique ───────────
/** Lot du registre tel que vu par l'écrêtage (sous-ensemble de ProductBatch). */
export interface LedgerLotLike {
  quantity: number;
  admissionDate?: Date | string | null;
  batchNumber?: string | null;
}

/**
 * Plan d'ÉCRÊTAGE du registre d'un article : la somme des quantités par lot ne
 * peut PAS dépasser le stock PHYSIQUE de l'article (« 396 kg en stock, impossible
 * d'avoir 308 + 352 + 210 + 88 au registre »). Quand elle le dépasse, le surplus
 * est fantôme : dérive historique d'avant le suivi complet des mouvements, ou
 * ventes passées directement dans SAP (invisibles de TeleVent, jamais débitées).
 *
 * Répartition FIFO : le fantôme vit dans les lots les PLUS ANCIENS (en réalité
 * déjà vendus) → on retire le surplus du plus vieux vers le plus récent
 * (admission croissante, inconnue = réputé récent, écrêté en dernier). Plancher 0.
 *
 * Renvoie UNIQUEMENT les lots à corriger, avec leur NOUVELLE quantité (arrondie
 * au millième, comme debitLots). Somme finale ≤ stock physique ; registre déjà
 * ≤ stock (ou stock inconnu ≤ 0 avec registre vide) → aucun changement.
 */
export function planLedgerTrim<T extends LedgerLotLike>(
  lots: T[],
  physicalStock: number,
): { lot: T; quantity: number }[] {
  const round3 = (n: number) => Math.round(n * 1000) / 1000;
  const stock = Math.max(0, physicalStock);
  const total = lots.reduce((s, l) => s + Math.max(0, l.quantity), 0);
  let surplus = round3(total - stock);
  if (surplus <= 0) return [];

  const time = (l: LedgerLotLike): number => {
    const t = l.admissionDate ? new Date(l.admissionDate).getTime() : NaN;
    return Number.isFinite(t) ? t : Infinity;
  };
  const ordered = [...lots].sort(
    (a, b) => time(a) - time(b)
      || String(a.batchNumber ?? "").localeCompare(String(b.batchNumber ?? "")),
  );

  const trims: { lot: T; quantity: number }[] = [];
  for (const lot of ordered) {
    if (surplus <= 0) break;
    if (lot.quantity <= 0) continue;
    const cut = Math.min(lot.quantity, surplus);
    surplus = round3(surplus - cut);
    trims.push({ lot, quantity: round3(lot.quantity - cut) });
  }
  return trims;
}

export type LotChoice = {
  lot: string;                                       // JAMAIS vide — EM<DocNum> ou EM_PENDING
  reason: "fifo" | "decouvert" | "aucun-pdn" | "env-defaut";
};

/**
 * Décision systématique du lot d'une ligne de commande (bug BL 24011560 : une
 * ligne ne doit JAMAIS partir sans U_NoLot).
 *   • lot FIFO résolu + stock (local OU SAP) → on pose le lot.
 *   • lot résolu mais aucun stock nulle part → vente à découvert → EM_PENDING.
 *   • aucun lot résolvable (article hors fenêtre de scan PDN, kit fabriqué…)
 *     → EM_PENDING (réécrit à la prochaine EM), sauf si un défaut env est fourni.
 * `sapOnHand` (Items.QuantityOnStock) sert de filet quand le miroir local est
 * obsolète (cas réel : fraises réceptionnées le matin, polling stock en retard).
 */
export function chooseLot(opts: {
  resolvedLot: string | null;       // EM<DocNum> du lotResolver, null si introuvable
  localAvailable: number;           // stock dispo agrégé du miroir local (peut être faux)
  sapOnHand?: number | null;        // SAP Items.QuantityOnStock (vérité SAP si dispo)
  envDefault?: string | null;       // GERVIFRAIS_LOT_DEFAUT (opt-in, sinon ignoré)
}): LotChoice {
  const hasStock = opts.localAvailable > 0 || (opts.sapOnHand ?? 0) > 0;
  if (opts.resolvedLot && hasStock) return { lot: opts.resolvedLot, reason: "fifo" };
  if (!opts.resolvedLot && hasStock) {
    const envDef = (opts.envDefault ?? "").trim();
    if (envDef) return { lot: envDef, reason: "env-defaut" };
    return { lot: LOT_PENDING, reason: "aucun-pdn" };
  }
  return { lot: LOT_PENDING, reason: "decouvert" };
}

// ── Unité d'affichage / vente ─────────────────────────────────
/**
 * Détermine comment afficher/saisir un produit.
 *
 * RÉGIME HISTORIQUE (salesItemsPerUnit absent/null — strictement inchangé) :
 *   • Vente au kg → AU KILO (packDivisor 1, unité "kg")
 *   • Tout le reste → AU COLIS (packDivisor = SalPackUn, unité "colis")
 *
 * NOUVEAU RÉGIME (salesItemsPerUnit fourni — Product.salesItemsPerUnit peuplé
 * au sync ; relevé SAP réel via scripts/diag-condi.mjs) :
 *   unités de base / colis = NumInSale (SalesItemsPerUnit) × SalPackUn (SalesQtyPerPackUnit)
 *   • Fraise FB4KA3 : SalesUnit "KG", NumInSale 1, SalPackUn 4, poids 1 kg/unité,
 *     condi "8x500g" → colis de 4 kg : on AFFICHE/prix au kilo, on VEND au colis
 *     (packDivisor 4 → quantité SAP = colis × 4, en KG — vérifié sur BL réels :
 *     Quantity=28 KG / PackageQuantity=7).
 *   • FRAMB12PD : "pie" ×12 × 0,125 kg → colis de 1,5 kg, prix /pie (inchangé).
 *   `colisWeightKg` (poids d'un colis) n'est exposé QUE dans ce régime — pour
 *   l'affichage « colis de 4 kg » — afin de ne pas altérer les objets historiques.
 *
 * Le prix reste TOUJOURS à l'unité de base SAP (priceUnit : kg/pie), envoyé tel
 * quel à SAP. La quantité SAP = qté_colis × packDivisor (unités de base).
 */
export function unitInfo(
  salesUnit?: string | null,
  salesQtyPerPackUnit?: number | null,
  salesItemsPerUnit?: number | null,
  salesUnitWeight?: number | null,
): {
  packDivisor: number; displayUnit: string; priceUnit: string; isKg: boolean;
  colisWeightKg?: number | null;
} {
  const unit = (salesUnit || "").trim();
  const isKg = /kg|kilo/i.test(unit);

  // ── Régime historique : comportement strictement identique (NULL-SAFE) ──
  if (salesItemsPerUnit == null) {
    if (isKg) return { packDivisor: 1, displayUnit: "kg", priceUnit: "kg", isKg: true };
    const div = salesQtyPerPackUnit && salesQtyPerPackUnit > 1 ? salesQtyPerPackUnit : 1;
    return { packDivisor: div, displayUnit: div > 1 ? "colis" : (unit || "u."), priceUnit: unit || "pie", isKg: false };
  }

  // ── Nouveau régime : NumInSale × SalPackUn = unités de base par colis ──
  const numInSale = salesItemsPerUnit > 0 ? salesItemsPerUnit : 1;
  const salPackUn = salesQtyPerPackUnit && salesQtyPerPackUnit > 0 ? salesQtyPerPackUnit : 1;
  const perColis = numInSale * salPackUn;
  // Poids d'un colis : unités de base × poids/unité. Pour un article vendu au KG,
  // le poids d'une unité de base est 1 kg par définition (relevé SAP : UnitWgt=1).
  const unitWeight = salesUnitWeight && salesUnitWeight > 0 ? salesUnitWeight : (isKg ? 1 : null);
  const colisWeightKg = unitWeight != null ? Math.round(perColis * unitWeight * 1000) / 1000 : null;

  if (isKg) {
    // Vendu au poids : affichage/prix au kilo, vente par colis de N kg.
    if (perColis > 1) {
      return { packDivisor: perColis, displayUnit: "colis", priceUnit: "kg", isKg: true, colisWeightKg };
    }
    return { packDivisor: 1, displayUnit: "kg", priceUnit: "kg", isKg: true, colisWeightKg };
  }
  return {
    packDivisor: perColis,
    displayUnit: perColis > 1 ? "colis" : (unit || "u."),
    priceUnit: unit || "pie",
    isKg: false,
    colisWeightKg,
  };
}

// ── Stock perso commercial ────────────────────────────────────
/** Stock attribué à un commercial = stock dispo × (pct/100), arrondi 1 décimale. */
export function personalStock(available: number, sharePct: number): number {
  const a = Math.max(0, available) * (Math.max(0, sharePct) / 100);
  return Math.floor(a * 10) / 10;
}

// ── Unité d'affichage du STOCK par groupe article ─────────────
/** Unité d'affichage choisie pour un groupe : kilo, colis ou pièce. */
export type StockDisplayUnit = "kg" | "colis" | "piece";

/** Forme minimale d'un produit pour le calcul d'affichage stock. */
export interface StockUnitProduct {
  salesUnit?: string | null;
  inventoryUnit?: string | null;
  salesPackagingUnit?: string | null;
  salesQtyPerPackUnit?: number | null;
  salesUnitWeight?: number | null;
}

/**
 * Diviseur unités de base → colis. Cohérent avec ProductsTable.getPackDivisor :
 * un colis n'existe que si l'article porte une unité de conditionnement
 * (SalesPackagingUnit) ET un nombre d'unités > 1 (SalesQtyPerPackUnit).
 */
export function stockPackDivisor(p: StockUnitProduct): number {
  if (p.salesPackagingUnit && p.salesQtyPerPackUnit && p.salesQtyPerPackUnit > 1) {
    return p.salesQtyPerPackUnit;
  }
  return 1;
}

/**
 * Convertit un stock DISPONIBLE (exprimé en unités de base SAP = inventoryUnit)
 * vers l'unité d'affichage choisie pour le groupe article.
 *
 *   • kg    : article au poids → tel quel (le stock EST déjà en kg) ; article à
 *             la pièce → × salesUnitWeight (kg par pièce). C'est le cas qui règle
 *             l'incohérence FB4LA3 (affiché en colis) vs FB4CA3B (affiché en kg) :
 *             forcer « kg » sur le groupe ramène les deux au kilo.
 *   • colis : unités de base ÷ (unités par colis). Pas de demi-colis (floor amont).
 *   • pièce : article au poids → ÷ salesUnitWeight (nb de pièces) ; article déjà à
 *             la pièce → tel quel. (Choix utilisateur : « pièce = salesUnitWeight ».)
 *
 * `whole` = true ⇒ l'appelant tronque (jamais de fraction de colis/pièce).
 */
export function convertStockDisplay(
  available: number,
  target: StockDisplayUnit,
  p: StockUnitProduct,
): { qty: number; label: string; whole: boolean } {
  const unit = (p.salesUnit || p.inventoryUnit || "").trim();
  const isKg = /kg|kilo/i.test(unit);
  const weight = p.salesUnitWeight && p.salesUnitWeight > 0 ? p.salesUnitWeight : null;

  switch (target) {
    case "colis":
      return { qty: available / stockPackDivisor(p), label: "Colis", whole: true };
    case "piece": {
      const pieces = isKg && weight ? available / weight : available;
      return { qty: pieces, label: "pièce", whole: true };
    }
    case "kg":
    default: {
      const kg = isKg ? available : weight ? available * weight : available;
      return { qty: kg, label: "kg", whole: false };
    }
  }
}
