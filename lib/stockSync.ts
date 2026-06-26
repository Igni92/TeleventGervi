/**
 * Synchro stock SAP → DB locale en quasi temps réel.
 *
 * Deux primitives utilisées par la route /api/sap/sync/delta ET par /api/sap/orders :
 *  - refreshItemStocks(codes) : repull les ItemWarehouseInfo depuis SAP et upsert
 *    ProductStock. Source de vérité.
 *  - decrementLocalStock(lines) : décrément optimiste après création BL — latence 0
 *    pour le commercial. La sync delta corrigera au tick suivant si nécessaire.
 */
import { prisma } from "@/lib/prisma";
import { sap, type SapItem } from "@/lib/sapb1";

const WAREHOUSES = new Set(["000", "01", "R1"]);

/**
 * Écrit en base le stock (totalStock + ProductStock par entrepôt) d'UN article
 * SAP déjà résolu vers son productId local. Renvoie false si l'article ne porte
 * aucun entrepôt suivi (→ on ne touche pas au stock existant : jamais de remise à
 * zéro accidentelle). Partagé par refreshItemStocks (par code) et
 * refreshInStockMirror (pull groupé).
 */
async function writeItemStock(productId: string, it: SapItem): Promise<boolean> {
  const stocks = (it.ItemWarehouseInfoCollection ?? []).filter((w) => WAREHOUSES.has(w.WarehouseCode));
  if (stocks.length === 0) return false;
  await prisma.product.update({
    where: { id: productId },
    data: { totalStock: it.QuantityOnStock ?? 0, syncedAt: new Date() },
  });
  await Promise.all(stocks.map((w) => {
    const inStock = w.InStock ?? 0;
    const committed = w.Committed ?? 0;
    const ordered = w.Ordered ?? 0;
    return prisma.productStock.upsert({
      where: { productId_warehouse: { productId, warehouse: w.WarehouseCode } },
      update: { inStock, committed, ordered, available: inStock - committed, syncedAt: new Date() },
      create: { productId, warehouse: w.WarehouseCode, inStock, committed, ordered, available: inStock - committed },
    });
  }));
  return true;
}

/**
 * Rafraîchit le stock de TOUS les articles « en stock » côté SAP en UN appel
 * groupé (filtre serveur `QuantityOnStock gt 0`, pagination parallèle 500/page —
 * exactement le chemin éprouvé par la synchro catalogue), au lieu d'une requête
 * filtrée par paquet de codes. C'est 10-30× moins d'allers-retours SAP → le
 * pré-comptage d'inventaire passe de « très long » à quasi instantané.
 *
 * Couvre aussi les ÉPUISÉS : un article que le miroir croyait en stock mais que
 * SAP ne renvoie plus (stock retombé à 0) est remis à 0 localement — sinon le
 * comptage afficherait un « stock attendu » périmé.
 */
export async function refreshInStockMirror(): Promise<{ refreshed: number; total: number }> {
  // 1. SAP : articles valides, non gelés, stock total > 0 (un seul filtre serveur).
  const ITEMS_FILTER = "Valid eq 'tYES' and Frozen eq 'tNO' and QuantityOnStock gt 0";
  const SELECT = "ItemCode,QuantityOnStock,ItemWarehouseInfoCollection";
  let sapItems: SapItem[];
  try {
    sapItems = await sap.getAllParallel<SapItem>(
      `Items?$filter=${ITEMS_FILTER}&$select=${SELECT}`,
      `Items/$count?$filter=${ITEMS_FILTER}`,
      { pageSize: 500, env: "prod" },
    );
  } catch {
    // Repli : pagination séquentielle si /$count indispo sur ce Service Layer.
    sapItems = await sap.getAll<SapItem>(
      `Items?$filter=${ITEMS_FILTER}&$select=${SELECT}`,
      { pageSize: 500, env: "prod" },
    );
  }

  // 2. Résoudre les ids produits du miroir pour les codes SAP renvoyés.
  const sapCodes = sapItems.map((it) => it.ItemCode);
  const sapCodeSet = new Set(sapCodes);
  const products = await prisma.product.findMany({
    where: { itemCode: { in: sapCodes } },
    select: { id: true, itemCode: true },
  });
  const idByCode = new Map(products.map((p) => [p.itemCode, p.id]));

  // 3. Upserts en base, par vagues parallèles (DB locale → rapide).
  let refreshed = 0;
  const UPSERT_CONC = 25;
  for (let i = 0; i < sapItems.length; i += UPSERT_CONC) {
    const slice = sapItems.slice(i, i + UPSERT_CONC);
    const oks = await Promise.all(slice.map(async (it) => {
      const productId = idByCode.get(it.ItemCode);
      if (!productId) return false;
      try { return await writeItemStock(productId, it); }
      catch (e) { console.warn(`[stockSync] upsert ${it.ItemCode} échoué:`, (e as Error).message); return false; }
    }));
    refreshed += oks.filter(Boolean).length;
  }

  // 4. ÉPUISÉS : en stock dans le miroir mais absents du retour SAP → remettre à 0.
  const mirrorInStock = await prisma.product.findMany({
    where: { isPackaging: false, stocks: { some: { inStock: { gt: 0 } } } },
    select: { id: true, itemCode: true },
  });
  const depletedIds = mirrorInStock.filter((p) => !sapCodeSet.has(p.itemCode)).map((p) => p.id);
  if (depletedIds.length > 0) {
    await prisma.productStock.updateMany({
      where: { productId: { in: depletedIds } },
      data: { inStock: 0, available: 0, syncedAt: new Date() },
    });
    await prisma.product.updateMany({
      where: { id: { in: depletedIds } },
      data: { totalStock: 0, syncedAt: new Date() },
    });
  }

  return { refreshed, total: sapItems.length };
}

/**
 * Re-pull les ItemWarehouseInfo des codes donnés et upsert ProductStock.
 * PERF : un seul appel SAP par PAQUET de codes (filtre OData `ItemCode eq … or …`)
 * au lieu d'un appel par article — ~20× moins d'allers-retours. Sécurité : si un
 * article ne revient PAS avec ses entrepôts (collection vide), on ne touche pas à
 * son stock (jamais de remise à zéro accidentelle).
 */
export async function refreshItemStocks(itemCodes: string[]): Promise<number> {
  const unique = Array.from(new Set(itemCodes.filter(Boolean)));
  if (unique.length === 0) return 0;

  const products = await prisma.product.findMany({
    where: { itemCode: { in: unique } },
    select: { id: true, itemCode: true },
  });
  const idByCode = new Map(products.map((p) => [p.itemCode, p.id]));

  const CODES_PER_REQ = 20;   // articles par requête SAP
  const CONCURRENCY = 5;      // requêtes SAP en parallèle
  const reqs: string[][] = [];
  for (let i = 0; i < unique.length; i += CODES_PER_REQ) reqs.push(unique.slice(i, i + CODES_PER_REQ));

  const upsertItem = async (it: SapItem): Promise<boolean> => {
    const productId = idByCode.get(it.ItemCode);
    if (!productId) return false;                  // pas dans le miroir → on ignore
    return writeItemStock(productId, it);          // entrepôts vides → false (pas de RAZ)
  };

  let updated = 0;
  const done = new Set<string>();   // codes effectivement mis à jour par le batch
  for (let i = 0; i < reqs.length; i += CONCURRENCY) {
    const wave = reqs.slice(i, i + CONCURRENCY);
    const waves = await Promise.all(wave.map(async (codes) => {
      const filter = codes.map((c) => `ItemCode eq '${c.replace(/'/g, "''")}'`).join(" or ");
      try {
        const r = await sap.get<{ value: SapItem[] }>(
          `Items?$top=${codes.length}&$select=ItemCode,QuantityOnStock,ItemWarehouseInfoCollection&$filter=${encodeURIComponent(filter)}`,
        );
        return r.value ?? [];
      } catch (e) {
        console.warn(`[stockSync] batch refresh échoué (${codes.length} codes):`, (e as Error).message);
        return [];
      }
    }));
    for (const items of waves) {
      for (const it of items) {
        try { if (await upsertItem(it)) { updated++; done.add(it.ItemCode); } }
        catch (e) { console.warn(`[stockSync] upsert ${it.ItemCode} échoué:`, (e as Error).message); }
      }
    }
  }

  // SÉCURITÉ : si le batch n'a pas couvert un article (ex. ce Service Layer ne
  // renvoie pas la collection entrepôt en mode liste), on reprend ces codes en
  // requête PAR ARTICLE (méthode éprouvée). En cas de batch totalement KO, le
  // résultat est donc identique à l'ancien comportement (correct), jamais pire.
  const missed = unique.filter((c) => idByCode.has(c) && !done.has(c));
  if (missed.length > 0) {
    const PER_ITEM_CONC = 10;
    for (let i = 0; i < missed.length; i += PER_ITEM_CONC) {
      const batch = missed.slice(i, i + PER_ITEM_CONC);
      await Promise.all(batch.map(async (code) => {
        try {
          const it = await sap.get<SapItem>(
            `Items('${encodeURIComponent(code)}')?$select=ItemCode,QuantityOnStock,ItemWarehouseInfoCollection`,
          );
          if (await upsertItem(it)) updated++;
        } catch (e) {
          console.warn(`[stockSync] refresh ${code} échoué:`, (e as Error).message);
        }
      }));
    }
  }
  return updated;
}

/**
 * Décrément local immédiat (committed +=, available -=) pour les lignes d'un BL
 * qu'on vient de créer côté SAP — évite la fenêtre où le commercial pourrait revendre
 * ce qu'il vient de vendre. Best-effort : pas d'erreur si entrepôt non géré.
 */
export async function decrementLocalStock(
  lines: { itemCode: string; quantity: number; warehouseCode?: string }[],
): Promise<void> {
  await Promise.all(lines.map(async (l) => {
    if (!l.warehouseCode || !WAREHOUSES.has(l.warehouseCode) || l.quantity <= 0) return;
    const product = await prisma.product.findUnique({
      where: { itemCode: l.itemCode },
      select: { id: true },
    });
    if (!product) return;
    await prisma.productStock.updateMany({
      where: { productId: product.id, warehouse: l.warehouseCode },
      data: {
        committed: { increment: l.quantity },
        available: { decrement: l.quantity },
      },
    });
  }));
}

/**
 * Régularisation d'INVENTAIRE dans le miroir local : applique un delta SIGNÉ
 * (en unités d'inventaire SAP) sur inStock/available/totalStock — delta > 0 pour
 * un excédent (entrée), delta < 0 pour un manque (sortie). Contrairement à
 * decrementLocalStock (qui modélise une RÉSERVATION via committed), ici on touche
 * le stock RÉEL (inStock), car le mouvement SAP correspondant ajoute/retire
 * vraiment de la marchandise. Clampe à 0 (jamais de stock négatif local). La sync
 * delta SAP recalera la valeur exacte au tick suivant.
 */
export async function applyInventoryDelta(
  lines: { itemCode: string; deltaUnits: number; warehouseCode?: string }[],
): Promise<void> {
  await Promise.all(lines.map(async (l) => {
    const whs = l.warehouseCode ?? "01";
    if (!WAREHOUSES.has(whs) || !Number.isFinite(l.deltaUnits) || l.deltaUnits === 0) return;
    const product = await prisma.product.findUnique({
      where: { itemCode: l.itemCode },
      select: { id: true },
    });
    if (!product) return;
    const cur = await prisma.productStock.findUnique({
      where: { productId_warehouse: { productId: product.id, warehouse: whs } },
      select: { inStock: true, available: true },
    });
    const nextInStock = Math.max(0, (cur?.inStock ?? 0) + l.deltaUnits);
    const nextAvail = Math.max(0, (cur?.available ?? 0) + l.deltaUnits);
    await prisma.productStock.upsert({
      where: { productId_warehouse: { productId: product.id, warehouse: whs } },
      update: { inStock: nextInStock, available: nextAvail, syncedAt: new Date() },
      create: { productId: product.id, warehouse: whs, inStock: Math.max(0, l.deltaUnits), available: Math.max(0, l.deltaUnits) },
    });
    // totalStock = somme tous entrepôts → on applique le même delta (clampé ≥ 0).
    const prod = await prisma.product.findUnique({ where: { id: product.id }, select: { totalStock: true } });
    await prisma.product.update({
      where: { id: product.id },
      data: { totalStock: Math.max(0, (prod?.totalStock ?? 0) + l.deltaUnits), syncedAt: new Date() },
    });
  }));
}

/**
 * Incrément local immédiat (inStock +=, available +=) après création d'une entrée
 * marchandise (PurchaseDeliveryNote). Miroir de decrementLocalStock — supprime
 * la fenêtre où la marchandise serait reçue physiquement mais invisible côté UI
 * en attendant le polling SAP. Crée la ligne ProductStock si absente (premier
 * stock de ce produit dans cet entrepôt).
 */
export async function incrementLocalStock(
  lines: { itemCode: string; quantity: number; warehouseCode?: string }[],
): Promise<void> {
  await Promise.all(lines.map(async (l) => {
    if (!l.warehouseCode || !WAREHOUSES.has(l.warehouseCode) || l.quantity <= 0) return;
    const product = await prisma.product.findUnique({
      where: { itemCode: l.itemCode },
      select: { id: true },
    });
    if (!product) return;
    await prisma.productStock.upsert({
      where: { productId_warehouse: { productId: product.id, warehouse: l.warehouseCode } },
      update: {
        inStock:   { increment: l.quantity },
        available: { increment: l.quantity },
        syncedAt:  new Date(),
      },
      create: {
        productId: product.id,
        warehouse: l.warehouseCode,
        inStock:   l.quantity,
        available: l.quantity,
      },
    });
    await prisma.product.update({
      where: { id: product.id },
      data: { totalStock: { increment: l.quantity }, syncedAt: new Date() },
    });
  }));
}
