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
    if (!productId) return false;
    const stocks = (it.ItemWarehouseInfoCollection ?? []).filter((w) => WAREHOUSES.has(w.WarehouseCode));
    if (stocks.length === 0) return false;   // pas d'info entrepôt → on ne zappe pas le stock existant
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
  };

  let updated = 0;
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
        try { if (await upsertItem(it)) updated++; }
        catch (e) { console.warn(`[stockSync] upsert ${it.ItemCode} échoué:`, (e as Error).message); }
      }
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
