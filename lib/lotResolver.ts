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
};

/**
 * Sentinel pour les ventes à découvert : un BL créé sur un article sans stock
 * porte ce code de lot. La route /api/sap/goods-receipts cherche les Orders
 * ouverts du jour avec ce sentinel pour propager le vrai EM<DocNum> dès qu'un
 * PDN arrive. ⚠️ Doit rester un libellé ASCII court (PATCH SAP sur U_NoLot).
 * Valeur canonique dans lib/gervifrais-calc.ts (lib pure testée) — ré-export ici
 * pour les consommateurs historiques (goods-receipts, orders).
 */
export const LOT_PENDING = LOT_PENDING_PURE;

const TTL_MS = 10 * 60 * 1000;
// Profondeur de scan : ~1500 PDN ≈ 4-6 semaines de réceptions. Au-delà, un article
// sans réception récente part en EM_PENDING (réécrit à sa prochaine EM) — plus
// honnête que l'ancien fallback aveugle EM0000 (10 BL touchés sur 7 j, cf. diag).
const MAX_DOCS = 1500;
const PAGE_SIZE = 200;

let cache: { at: number; maps: LotMaps; partial: boolean } | null = null;

function emptyMaps(): LotMaps {
  return { byItemWhs: new Map(), byItem: new Map(), byItemWarehouse: new Map() };
}

/** Renvoie les maps (cache 10 min). Scanne les ~1500 derniers PDN au refresh. */
export async function getLotMaps(): Promise<LotMaps> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.maps;

  const maps = emptyMaps();
  type PdnLine = { ItemCode: string; WarehouseCode?: string };
  type Pdn = { DocNum: number; DocumentLines?: PdnLine[] };

  let scanned = 0;
  let partial = false;
  const t0 = Date.now();
  // DocNum de la dernière EM AVEC magasin par article (pour byItemWarehouse).
  const bestWhsDoc = new Map<string, number>();
  try {
    let skip = 0;
    while (skip < MAX_DOCS) {
      // ⚠️ Header Prefer obligatoire : sans lui le SL renvoie 20 docs max par page
      // (l'ancien $top=50 faisait 25 allers-retours pour 500 docs).
      const r = await sap.get<{ value: Pdn[] }>(
        `PurchaseDeliveryNotes?$top=${PAGE_SIZE}&$skip=${skip}&$orderby=DocNum desc&$select=DocNum,DocumentLines`,
        { headers: { Prefer: `odata.maxpagesize=${PAGE_SIZE}` } },
      );
      const docs = r.value || [];
      if (docs.length === 0) break;
      for (const d of docs) {
        for (const l of (d.DocumentLines || [])) {
          if (!l.ItemCode) continue;
          if (!maps.byItem.has(l.ItemCode) || d.DocNum > maps.byItem.get(l.ItemCode)!) {
            maps.byItem.set(l.ItemCode, d.DocNum);
          }
          if (l.WarehouseCode) {
            const key = `${l.ItemCode}|${l.WarehouseCode}`;
            if (!maps.byItemWhs.has(key) || d.DocNum > maps.byItemWhs.get(key)!) {
              maps.byItemWhs.set(key, d.DocNum);
            }
            // Magasin de la dernière EM (avec magasin) de l'article → repli "item".
            if (d.DocNum > (bestWhsDoc.get(l.ItemCode) ?? -1)) {
              bestWhsDoc.set(l.ItemCode, d.DocNum);
              maps.byItemWarehouse.set(l.ItemCode, l.WarehouseCode);
            }
          }
        }
      }
      scanned += docs.length;
      skip += docs.length;
      if (docs.length < PAGE_SIZE) break;   // dernière page atteinte
    }
  } catch (err) {
    partial = true;
    console.warn(
      `[lotResolver] Scan PurchaseDeliveryNotes interrompu après ${scanned} docs:`,
      (err as Error).message,
    );
    // Échec total ET ancien cache encore là → on garde l'ancien (mieux que vide).
    if (scanned === 0 && cache) return cache.maps;
  }

  // On cache même un scan partiel (mieux que de re-marteler SAP à chaque commande
  // et de retomber sur des maps vides) — le TTL re-tentera un scan complet.
  cache = { at: Date.now(), maps, partial };
  console.log(
    `[lotResolver] Maps rafraîchies: ${scanned} PDN scannés en ${Date.now() - t0} ms — ` +
    `${maps.byItem.size} items, ${maps.byItemWhs.size} couples item×entrepôt${partial ? " (PARTIEL)" : ""}`,
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
  if (warehouseCode) {
    const key = `${itemCode}|${warehouseCode}`;
    if (!maps.byItemWhs.has(key) || docNum > maps.byItemWhs.get(key)!) {
      maps.byItemWhs.set(key, docNum);
    }
    // Si ce PDN est désormais le plus récent de l'article, son magasin devient le
    // repli "item" (cohérent avec byItem ci-dessus).
    if (maps.byItem.get(itemCode) === docNum) maps.byItemWarehouse.set(itemCode, warehouseCode);
  }
}

/** Force l'expiration du cache — utile pour les tests. */
export function _resetLotCache(): void {
  cache = null;
}
