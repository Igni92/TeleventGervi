/**
 * Résolveur de lots Gervifrais — partagé entre /api/sap/orders (consommateur) et
 * /api/sap/goods-receipts (producteur).
 *
 * Règle confirmée sur BL réels :
 *   U_NoLot = "EM" + DocNum du DERNIER bon de réception (PurchaseDeliveryNote)
 *             contenant l'article DANS l'entrepôt concerné.
 *
 * PERF (chantier B, 2026-08) : les maps sont désormais construites DEPUIS LE
 * MIROIR Postgres (SapPurchaseDeliveryNote + SapPdnLine), plus AUCUN appel SAP.
 * Avant, chaque rafraîchissement scannait ~1500 réceptions en direct via le
 * Service Layer (8 pages de 200 docs + lignes) — la requête la plus lourde de
 * l'app, qui timeoutait à 25 s et faisait « charger à l'infini » les bons de
 * commande / la console / les livraisons. Le miroir (maintenu par le cron) est
 * local, instantané, et couvre PLUS d'historique que l'ancien plafond de 1500.
 *
 * Quand /api/sap/goods-receipts crée un nouveau PDN, il appelle bumpLot() pour
 * injecter le DocNum frais dans la map en mémoire sans attendre le prochain tick
 * de synchro miroir.
 */
import { prisma } from "./prisma";
import { LOT_PENDING as LOT_PENDING_PURE } from "./gervifrais-calc";

export type LotMaps = {
  byItemWhs: Map<string, number>;  // key = `${itemCode}|${warehouseCode}`
  byItem:    Map<string, number>;
  /** Magasin de la DERNIÈRE EM (avec magasin) de l'article — pour aligner le
   *  magasin sur le lot lors du repli "item" (vente à découvert : le lot doit
   *  amener la ligne dans le magasin où il a été reçu). */
  byItemWarehouse: Map<string, string>;
  /** HISTORIQUE des EM récentes (DocNums, plus récent d'abord, plafonné) par
   *  couple item×entrepôt et par item — permet de choisir un lot selon
   *  l'AFFECTATION de l'EM (Tous/Export/GMS/CHR, cf. lib/emAffect) au lieu de
   *  prendre aveuglément la dernière. */
  byItemWhsList: Map<string, number[]>;
  byItemList: Map<string, number[]>;
  /** Magasin de réception d'un article dans UNE EM donnée — `${item}|${docNum}`
   *  → entrepôt. Sert au repli "item" de resolveLotForSegment. */
  whsOfItemDoc: Map<string, string>;
  /** Métadonnées d'une EM (DocNum → date de réception + fournisseur) — pour
   *  afficher un libellé lisible au survol d'un lot candidat. */
  docMeta: Map<number, { date: string | null; supplier: string | null }>;
};

/** Profondeur d'historique par clé — assez pour retrouver une EM « stock »
 *  derrière plusieurs arrivages affectés (export). */
const LIST_MAX = 12;

/** Insère un DocNum dans une liste triée décroissante (dédupliquée, plafonnée). */
function pushDoc(map: Map<string, number[]>, key: string, docNum: number): void {
  const list = map.get(key) ?? [];
  if (list.includes(docNum)) return;
  const i = list.findIndex((d) => d < docNum);
  if (i < 0) list.push(docNum); else list.splice(i, 0, docNum);
  if (list.length > LIST_MAX) list.length = LIST_MAX;
  map.set(key, list);
}

/**
 * Sentinel pour les ventes à découvert : un BL créé sur un article sans stock
 * porte ce code de lot. La route /api/sap/goods-receipts cherche les Orders
 * ouverts du jour avec ce sentinel pour propager le vrai EM<DocNum> dès qu'un
 * PDN arrive. ⚠️ Doit rester un libellé ASCII court (PATCH SAP sur U_NoLot).
 * Valeur canonique dans lib/gervifrais-calc.ts (lib pure testée) — ré-export ici
 * pour les consommateurs historiques (goods-receipts, orders).
 */
export const LOT_PENDING = LOT_PENDING_PURE;

/**
 * TTL VOLONTAIREMENT SUPÉRIEUR à la période du cron miroir (10 min).
 *
 * À 10 min, le cache expirait pile entre deux ticks : la première personne à
 * ouvrir un écran qui résout des lots (bons de commande, console, livraisons)
 * repayait le scan des 1500 réceptions — 7 à 15 s d'attente, toutes les 10 min,
 * et c'est ce qui donnait « les bons de commande chargent super longtemps ».
 * Le cron rafraîchit maintenant toutes les 10 min (cf. warmLotMaps) et la
 * fenêtre de validité est plus large : un humain ne tombe plus jamais à froid.
 */
const TTL_MS = 20 * 60 * 1000;
/**
 * TTL RÉDUIT quand le scan est revenu incomplet (pages en échec). Servir des maps
 * partielles pendant 10 min, c'est résoudre les lots sur une fraction des
 * réceptions — le 30/07/2026, 56 articles connus au lieu de 280, soit des
 * affectations de lot erronées pendant tout le palier. On garde le partiel (mieux
 * que rien, et ça évite de marteler SAP), mais on retente vite.
 */
const PARTIAL_TTL_MS = 60 * 1000;

let cache: { at: number; maps: LotMaps; partial: boolean } | null = null;
/**
 * Scan EN COURS, partagé. Sans lui, N requêtes concurrentes arrivant sur un cache
 * froid (démarrage d'instance, ou expiration du TTL au moment d'un pic) lançaient
 * CHACUNE un scan complet des ~1500 réceptions : SAP se faisait marteler et
 * toutes les requêtes ralentissaient ensemble — l'écran « chargeait à l'infini »
 * précisément quand plusieurs personnes l'ouvraient en même temps. Les appels
 * concurrents attendent désormais le même scan.
 */
let inflight: Promise<LotMaps> | null = null;

function emptyMaps(): LotMaps {
  return {
    byItemWhs: new Map(), byItem: new Map(), byItemWarehouse: new Map(),
    byItemWhsList: new Map(), byItemList: new Map(), whsOfItemDoc: new Map(),
    docMeta: new Map(),
  };
}

/** Renvoie les maps (cache TTL_MS). Scanne les ~1500 derniers PDN au refresh. */
export async function getLotMaps(opts?: { force?: boolean }): Promise<LotMaps> {
  const ttl = cache?.partial ? PARTIAL_TTL_MS : TTL_MS;
  if (!opts?.force && cache && Date.now() - cache.at < ttl) return cache.maps;
  // Un scan déjà lancé ? On s'y raccroche au lieu d'en démarrer un second.
  if (inflight) return inflight;
  inflight = scanLotMaps().finally(() => { inflight = null; });
  return inflight;
}

/**
 * PRÉCHAUFFAGE — appelé par le cron miroir à chaque tick.
 *
 * Même principe que `warmAccueil` : le scan des réceptions coûte le même prix
 * qu'avant (une fois toutes les 10 min), mais c'est le cron qui le paie et non
 * la personne qui ouvre l'écran. `force` remet le compteur de fraîcheur à zéro
 * pour que la fenêtre de validité couvre toujours l'intervalle jusqu'au tick
 * suivant. Best-effort : ne fait jamais échouer la synchro.
 */
export async function warmLotMaps(): Promise<void> {
  try {
    await getLotMaps({ force: true });
  } catch (e) {
    console.warn("[lotResolver] préchauffage échoué:", (e as Error).message);
  }
}

type PdnRow = {
  docNum: number;
  docDate: Date | null;
  cardName: string | null;
  itemCode: string;
  warehouseCode: string | null;
};

async function scanLotMaps(): Promise<LotMaps> {
  const maps = emptyMaps();
  const t0 = Date.now();
  // DocNum de la dernière EM AVEC magasin par article (pour byItemWarehouse).
  const bestWhsDoc = new Map<string, number>();

  // Lecture DEPUIS LE MIROIR (SapPurchaseDeliveryNote + SapPdnLine) — 0 appel SAP.
  // Réceptions NON annulées, lignes AVEC itemCode, les plus RÉCENTES d'abord
  // (DocNum desc) : la première occurrence d'un article porte donc son DocNum max
  // (règle U_NoLot = « EM » + dernier DocNum contenant l'article dans l'entrepôt).
  // L'ordre (DocNum desc, lineNum asc) garantit un résultat déterministe et
  // identique à l'ancien scan paginé. docMeta = premier vu = doc le plus récent.
  let rows: PdnRow[];
  try {
    rows = await prisma.$queryRaw<PdnRow[]>`
      SELECT p."docNum" AS "docNum", p."docDate" AS "docDate", p."cardName" AS "cardName",
             l."itemCode" AS "itemCode", l."warehouseCode" AS "warehouseCode"
      FROM "SapPdnLine" l
      JOIN "SapPurchaseDeliveryNote" p ON p."docEntry" = l."docEntry"
      WHERE p."cancelled" = false AND p."docNum" IS NOT NULL AND l."itemCode" IS NOT NULL
      ORDER BY p."docNum" DESC, l."lineNum" ASC`;
  } catch (e) {
    // La base locale échoue rarement ; si ça arrive, on préfère servir l'ancien
    // cache (mieux que des maps vides qui casseraient toute résolution de lot).
    console.warn("[lotResolver] lecture miroir échouée:", (e as Error).message);
    if (cache) return cache.maps;
    throw e;
  }

  const seenDocs = new Set<number>();
  for (const r of rows) {
    const { docNum, itemCode } = r;
    // Métadonnées EM (date + fournisseur) — premier vu = plus récent.
    if (!maps.docMeta.has(docNum)) {
      maps.docMeta.set(docNum, {
        date: r.docDate ? r.docDate.toISOString().slice(0, 10) : null,
        supplier: r.cardName ?? null,
      });
    }
    if (!maps.byItem.has(itemCode) || docNum > maps.byItem.get(itemCode)!) {
      maps.byItem.set(itemCode, docNum);
    }
    pushDoc(maps.byItemList, itemCode, docNum);
    if (r.warehouseCode) {
      const key = `${itemCode}|${r.warehouseCode}`;
      if (!maps.byItemWhs.has(key) || docNum > maps.byItemWhs.get(key)!) {
        maps.byItemWhs.set(key, docNum);
      }
      pushDoc(maps.byItemWhsList, key, docNum);
      maps.whsOfItemDoc.set(`${itemCode}|${docNum}`, r.warehouseCode);
      // Magasin de la dernière EM (avec magasin) de l'article → repli "item".
      if (docNum > (bestWhsDoc.get(itemCode) ?? -1)) {
        bestWhsDoc.set(itemCode, docNum);
        maps.byItemWarehouse.set(itemCode, r.warehouseCode);
      }
    }
    seenDocs.add(docNum);
  }

  cache = { at: Date.now(), maps, partial: false };
  console.log(
    `[lotResolver] Maps rafraîchies (miroir): ${seenDocs.size} PDN, ${rows.length} lignes en ${Date.now() - t0} ms — ` +
    `${maps.byItem.size} items, ${maps.byItemWhs.size} couples item×entrepôt`,
  );
  return maps;
}

export type ResolvedLot = {
  lot: string | null;                       // "EM<DocNum>" ou null si introuvable
  source: "whs" | "item" | null;            // précision de la résolution
  docNum: number | null;
  /** Magasin où ce lot a été reçu : l'entrepôt interrogé pour la source "whs",
   *  le magasin de la dernière EM pour le repli "item" (peut être null si
   *  inconnu). Permet d'aligner le magasin de la ligne sur le lot retenu. */
  warehouse: string | null;
};

/**
 * Résolution détaillée : EM<DocNum> par (item,entrepôt) → (item) → null.
 * Contrairement à resolveLot(), PAS de fallback EM0000 : l'appelant décide
 * (cf. chooseLot() dans lib/gervifrais-calc.ts → sentinel EM_PENDING).
 */
export function resolveLotDetailed(maps: LotMaps, itemCode: string, warehouseCode?: string): ResolvedLot {
  if (warehouseCode) {
    const n = maps.byItemWhs.get(`${itemCode}|${warehouseCode}`);
    if (n) return { lot: `EM${n}`, source: "whs", docNum: n, warehouse: warehouseCode };
  }
  const g = maps.byItem.get(itemCode);
  if (g) return { lot: `EM${g}`, source: "item", docNum: g, warehouse: maps.byItemWarehouse.get(itemCode) ?? null };
  return { lot: null, source: null, docNum: null, warehouse: null };
}

/**
 * Résolution par SEGMENT CLIENT : choisit, parmi les EM récentes de l'article,
 * celle dont l'AFFECTATION (lib/emAffect : DocNum → "EXPORT"|"GMS"|"CHR",
 * absent = « Tous ») correspond au client servi. Règle métier (export) : les
 * achats de dernière minute affectés à un segment ne se mélangent pas au stock.
 *
 * Ordre de choix, par (item×entrepôt) puis repli (item) :
 *   1. EM la plus récente affectée AU segment du client ;
 *   2. sinon EM la plus récente NON affectée (« Tous » — le stock commun) ;
 *   3. sinon (que des EM affectées à d'AUTRES segments) → lot null : on ne vole
 *      pas leur lot, l'appelant part en LOT_PENDING et la propagation rétro
 *      posera le bon lot à la prochaine réception compatible.
 * Client sans segment → seules les EM « Tous » sont éligibles (cas 2).
 */
export function resolveLotForSegment(
  maps: LotMaps,
  affects: Map<number, string>,
  itemCode: string,
  warehouseCode: string | undefined,
  segment: string | null,
): ResolvedLot {
  const seg = (segment ?? "").trim().toUpperCase();
  const pick = (docs: number[] | undefined): number | null => {
    if (!docs || docs.length === 0) return null;
    if (seg) {
      const own = docs.find((d) => affects.get(d) === seg);
      if (own != null) return own;
    }
    const open = docs.find((d) => !affects.has(d));
    return open ?? null;
  };
  if (warehouseCode) {
    const n = pick(maps.byItemWhsList.get(`${itemCode}|${warehouseCode}`));
    if (n != null) return { lot: `EM${n}`, source: "whs", docNum: n, warehouse: warehouseCode };
  }
  const g = pick(maps.byItemList.get(itemCode));
  if (g != null) {
    return {
      lot: `EM${g}`, source: "item", docNum: g,
      warehouse: maps.whsOfItemDoc.get(`${itemCode}|${g}`) ?? maps.byItemWarehouse.get(itemCode) ?? null,
    };
  }
  return { lot: null, source: null, docNum: null, warehouse: null };
}

/**
 * Résout le n° de lot : EM<DocNum> par (item,entrepôt) → (item) → défaut env.
 * Conservé pour compatibilité (tests lotResolver.test.ts) — les nouvelles
 * écritures passent par resolveLotDetailed() + chooseLot().
 */
export function resolveLot(maps: LotMaps, itemCode: string, warehouseCode?: string): string {
  const detailed = resolveLotDetailed(maps, itemCode, warehouseCode);
  if (detailed.lot) return detailed.lot;
  return (process.env.GERVIFRAIS_LOT_DEFAUT || "EM0000").trim();
}

/**
 * Injecte un (item, entrepôt, DocNum) frais dans la map APRÈS création d'un PDN —
 * pour que la prochaine Order utilise immédiatement le nouveau lot sans attendre
 * l'expiration TTL. No-op si le cache n'est pas encore chaud (sera rempli au prochain
 * getLotMaps()).
 */
export function bumpLot(itemCode: string, warehouseCode: string | undefined, docNum: number): void {
  if (!cache) return;
  const { maps } = cache;
  if (!maps.byItem.has(itemCode) || docNum > maps.byItem.get(itemCode)!) {
    maps.byItem.set(itemCode, docNum);
  }
  pushDoc(maps.byItemList, itemCode, docNum);
  if (warehouseCode) {
    const key = `${itemCode}|${warehouseCode}`;
    if (!maps.byItemWhs.has(key) || docNum > maps.byItemWhs.get(key)!) {
      maps.byItemWhs.set(key, docNum);
    }
    pushDoc(maps.byItemWhsList, key, docNum);
    maps.whsOfItemDoc.set(`${itemCode}|${docNum}`, warehouseCode);
    // Si ce PDN est désormais le plus récent de l'article, son magasin devient le
    // repli "item" (cohérent avec byItem ci-dessus).
    if (maps.byItem.get(itemCode) === docNum) maps.byItemWarehouse.set(itemCode, warehouseCode);
  }
}

/** Force l'expiration du cache — utile pour les tests. */
export function _resetLotCache(): void {
  cache = null;
}
