/**
 * Résolveur de lots Gervifrais — partagé entre /api/sap/orders (consommateur) et
 * /api/sap/goods-receipts (producteur).
 *
 * Règle confirmée sur BL réels :
 *   U_NoLot = "EM" + DocNum du DERNIER bon de réception (PurchaseDeliveryNote)
 *             contenant l'article DANS l'entrepôt concerné.
 *
 * Le cache est rafraîchi 1× / 10 min en scannant les derniers PDN.
 * Quand /api/sap/goods-receipts crée un nouveau PDN, il appelle bumpLot()
 * pour injecter le DocNum frais dans la map (sans attendre l'expiration TTL).
 *
 * ⚠️ Particularités Service Layer de CETTE base (vérifiées scripts/diag-carriers.mjs) :
 *   - sans header `Prefer: odata.maxpagesize=N`, toute réponse est plafonnée à
 *     PageSize=20 (b1s.conf), même avec $top élevé ;
 *   - le filtre lambda `DocumentLines/any(...)` renvoie HTTP 400 → impossible de
 *     faire une requête ciblée « dernier PDN contenant l'article X » : le scan
 *     paginé reste la seule voie.
 */
import { sap } from "./sapb1";
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
// Profondeur de scan : ~1500 PDN ≈ 4-6 semaines de réceptions. Au-delà, un article
// sans réception récente part en EM_PENDING (réécrit à sa prochaine EM) — plus
// honnête que l'ancien fallback aveugle EM0000 (10 BL touchés sur 7 j, cf. diag).
const MAX_DOCS = 1500;
const PAGE_SIZE = 200;

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
/**
 * Budget par page. Le défaut de `sapb1` (90 s) dépasse la durée de vie des routes
 * interactives : une page lente tuait la fonction avant toute réponse. Ici on
 * échoue vite, et `Promise.allSettled` conserve les pages abouties (maps
 * partielles) plutôt que de tout perdre.
 */
const PAGE_TIMEOUT_MS = 25_000;

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

async function scanLotMaps(): Promise<LotMaps> {
  const maps = emptyMaps();
  type PdnLine = { ItemCode: string; WarehouseCode?: string };
  type Pdn = { DocNum: number; DocDate?: string; CardName?: string; DocumentLines?: PdnLine[] };

  let scanned = 0;
  let partial = false;
  let failedPages = 0;
  const t0 = Date.now();
  // DocNum de la dernière EM AVEC magasin par article (pour byItemWarehouse).
  const bestWhsDoc = new Map<string, number>();

  // Pagination PARALLÈLE : les offsets sont connus d'avance ($orderby DocNum desc,
  // pages fixes de PAGE_SIZE), donc inutile d'attendre une page pour demander la
  // suivante. L'ancienne boucle séquentielle enchaînait jusqu'à MAX_DOCS/PAGE_SIZE
  // allers-retours SAP (8 pages × ~1-3 s) SUR LE CHEMIN CRITIQUE de tout écran qui
  // résout des lots (bons de commande, console, livraisons) : au refresh du cache
  // (TTL 10 min, et à froid sur chaque instance serverless) l'écran restait en
  // « chargement » des dizaines de secondes, jusqu'au timeout.
  //
  // Sûr vis-à-vis de l'ordre : `pushDoc` insère en ordre DÉCROISSANT trié et
  // plafonne la queue, et les autres maps gardent le DocNum MAX — le résultat est
  // donc identique quel que soit l'ordre d'ingestion des pages. On ingère malgré
  // tout dans l'ordre des offsets (Promise.allSettled préserve l'ordre) pour que
  // `docMeta` (premier gagnant) reste sur le doc le plus récent, comme avant.
  const pageCount = Math.ceil(MAX_DOCS / PAGE_SIZE);

  // Concurrence VOLONTAIREMENT BASSE. Ces pages sont les requêtes les plus
  // lourdes de l'application : 200 documents AVEC toutes leurs lignes chacun.
  // Lancer les 8 d'un coup a été mesuré en prod le 30/07/2026 — 7 pages sur 8
  // en timeout à 25 s, scan retombé à 200 documents sur 1500. Le portillon
  // global du client SAP (5) protège l'applicatif dans son ensemble, mais il
  // reste trop permissif POUR CE CAS : on borne donc ici, au plus près.
  // Deux pages de front restent ~2 fois plus rapides que l'ancienne boucle
  // séquentielle, sans mettre le Service Layer à genoux.
  const PAGE_CONCURRENCY = 2;
  const fetchPage = (i: number) =>
    // ⚠️ Header Prefer obligatoire : sans lui le SL renvoie 20 docs max par page
    // (l'ancien $top=50 faisait 25 allers-retours pour 500 docs).
    sap.get<{ value: Pdn[] }>(
      `PurchaseDeliveryNotes?$top=${PAGE_SIZE}&$skip=${i * PAGE_SIZE}&$orderby=DocNum desc&$select=DocNum,DocDate,CardName,DocumentLines`,
      { headers: { Prefer: `odata.maxpagesize=${PAGE_SIZE}` }, timeoutMs: PAGE_TIMEOUT_MS },
    );

  // Résultats rangés PAR OFFSET (et non par ordre d'arrivée) : `docMeta` garde
  // le premier gagnant, donc l'ingestion doit rester dans l'ordre des pages.
  const settled: PromiseSettledResult<{ value: Pdn[] }>[] = [];
  for (let start = 0; start < pageCount; start += PAGE_CONCURRENCY) {
    const wave = await Promise.allSettled(
      Array.from(
        { length: Math.min(PAGE_CONCURRENCY, pageCount - start) },
        (_, k) => fetchPage(start + k),
      ),
    );
    settled.push(...wave);
  }

  for (const res of settled) {
    if (res.status === "rejected") {
      // Une page en échec ne condamne pas le scan : les autres restent exploitables
      // (maps partielles → le TTL re-tentera un scan complet).
      partial = true;
      failedPages++;
      console.warn("[lotResolver] Page PurchaseDeliveryNotes en échec:", (res.reason as Error)?.message);
      continue;
    }
    const docs = res.value.value || [];
    for (const d of docs) {
      // Métadonnées EM (date de réception + fournisseur) pour le libellé au survol.
      if (!maps.docMeta.has(d.DocNum)) {
        maps.docMeta.set(d.DocNum, { date: d.DocDate ? d.DocDate.slice(0, 10) : null, supplier: d.CardName ?? null });
      }
      for (const l of (d.DocumentLines || [])) {
        if (!l.ItemCode) continue;
        if (!maps.byItem.has(l.ItemCode) || d.DocNum > maps.byItem.get(l.ItemCode)!) {
          maps.byItem.set(l.ItemCode, d.DocNum);
        }
        pushDoc(maps.byItemList, l.ItemCode, d.DocNum);
        if (l.WarehouseCode) {
          const key = `${l.ItemCode}|${l.WarehouseCode}`;
          if (!maps.byItemWhs.has(key) || d.DocNum > maps.byItemWhs.get(key)!) {
            maps.byItemWhs.set(key, d.DocNum);
          }
          pushDoc(maps.byItemWhsList, key, d.DocNum);
          maps.whsOfItemDoc.set(`${l.ItemCode}|${d.DocNum}`, l.WarehouseCode);
          // Magasin de la dernière EM (avec magasin) de l'article → repli "item".
          if (d.DocNum > (bestWhsDoc.get(l.ItemCode) ?? -1)) {
            bestWhsDoc.set(l.ItemCode, d.DocNum);
            maps.byItemWarehouse.set(l.ItemCode, l.WarehouseCode);
          }
        }
      }
    }
    scanned += docs.length;
  }

  // Échec TOTAL ET ancien cache encore là → on garde l'ancien (mieux que vide).
  if (scanned === 0 && partial && cache) return cache.maps;

  // On cache même un scan partiel (mieux que de re-marteler SAP à chaque commande
  // et de retomber sur des maps vides) — le TTL re-tentera un scan complet.
  cache = { at: Date.now(), maps, partial };
  console.log(
    `[lotResolver] Maps rafraîchies: ${scanned} PDN scannés en ${Date.now() - t0} ms — ` +
    `${maps.byItem.size} items, ${maps.byItemWhs.size} couples item×entrepôt` +
    (partial ? ` (PARTIEL — ${failedPages}/${pageCount} pages en échec, re-scan dans ${PARTIAL_TTL_MS / 1000}s)` : ""),
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
