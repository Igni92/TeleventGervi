import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { requireAdmin } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { sap, type SapItem, type SapItemGroup, type SapBatchDetail } from "@/lib/sapb1";
import { isCronAuthorized } from "@/lib/cronAuth";

// ~1300 items paginés depuis SAP → peut dépasser le défaut serverless.
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * POST /api/sap/sync/products
 *
 * Pulls all products from SAP B1 (paginated) and upserts them into the local
 * Product + ProductStock tables. Only keeps the warehouses we care about for
 * televente: 000 (A/C-A/D), 01 (Stock physique), R1 (J+1 livraison demain).
 *
 * Emballages (group 114) and "noise" groups (100-130 with dot names) are kept
 * in DB but tagged `isPackaging=true` so the UI can filter them out by default.
 *
 * Idempotent — safe to call repeatedly. ~1300 items × 1 SAP call (paginated).
 */

const WAREHOUSES_TO_SYNC = new Set(["000", "01", "R1"]);
// Group 114 = Emballage. Groupes 100-130 ont des noms du type "." ".." "..." (parasites).
const PACKAGING_GROUP_CODES = new Set([114]);
const NOISE_GROUP_CODES = new Set([100, 104, 105, 111, 112, 117, 121, 126, 128, 130]);

export async function POST(req: NextRequest) {
  // Déclenchement machine (cron Vercel via CRON_SECRET) OU admin en session.
  const cron = isCronAuthorized(req);
  const session = cron ? null : await auth();
  if (!cron) {
    if (!session?.user) {
      return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
    }
    if (!(await requireAdmin(session))) {
      return NextResponse.json({ error: "Réservé aux administrateurs" }, { status: 403 });
    }
  }

  const startedAt = new Date();
  const log = await prisma.syncLog.create({
    data: {
      source: "sap",
      type: "products",
      status: "running",
      startedAt,
      triggeredBy: cron ? "cron" : session?.user.id ?? null,
    },
  });

  try {
    // ── 1. Resolve item groups (id → name) — done once ─────
    const groups = await sap.getAll<SapItemGroup>(
      "ItemGroups?$select=Number,GroupName",
      { env: "prod" },
    );
    const groupNameById = new Map(groups.map((g) => [g.Number, g.GroupName]));

    // ── 2. Fetch all items — PARALLÈLE ($count puis toutes les pages en
    // Promise.all via getAllParallel, ~3-5× plus rapide que le séquentiel).
    // Filtre SAP côté serveur (1367 → ~425 actifs) identique sur le count et
    // les pages. Inclut les champs unités étendus + SalesItemsPerUnit.
    const ITEMS_FILTER = "Valid eq 'tYES' and Frozen eq 'tNO'";
    // Base SÛRE (champs historiques connus pour fonctionner sur ce SAP).
    const ITEMS_SELECT_BASE =
      "ItemCode,ItemName,ItemsGroupCode,SalesUnit,SalesPackagingUnit,SalesQtyPerPackUnit,SalesItemsPerUnit,SalesUnitWeight,InventoryUOM,PurchaseUnit,ManageBatchNumbers,QuantityOnStock,ItemWarehouseInfoCollection,Valid,Frozen,U_Pays,U_GER_Marque,U_GER_Det_Condt,U_GER_CALIBRE,U_GER_UVC,U_GER_NB_BARQ_COLIS";
    // + variété. Sur la Service Layer SAP B1, la colonne DB « FrgnName » est
    // exposée sous le nom de propriété OData « ForeignName » (FrgnName renvoie
    // 400 « Property invalid »). On sélectionne donc ForeignName. Si ce champ
    // n'est pas sélectionnable sur ce SAP, la requête échoue : on RETOMBE sur la
    // base SÛRE pour ne JAMAIS casser la synchro stock (variété simplement vide).
    const ITEMS_SELECT_FULL = `ItemCode,ItemName,ForeignName,${ITEMS_SELECT_BASE.slice("ItemCode,ItemName,".length)}`;
    // ⚠️ SalesItemsPerUnit (NumInSale) absent du type partagé SapItem ET du
    // client Prisma généré (colonne Product."salesItemsPerUnit" existe en base
    // mais pas dans le client) → extension de type locale + écriture raw SQL.
    type SapItemEx = SapItem & { SalesItemsPerUnit?: number; ForeignName?: string; FrgnName?: string; U_GER_CALIBRE?: string };
    let items: SapItemEx[];
    try {
      items = await sap.getAllParallel<SapItemEx>(
        `Items?$filter=${ITEMS_FILTER}&$select=${ITEMS_SELECT_FULL}`,
        `Items/$count?$filter=${ITEMS_FILTER}`,
        { pageSize: 500, env: "prod" },
      );
    } catch (e) {
      console.warn("[sync products] $select avec ForeignName échoué — fallback sans variété:", (e as Error).message);
      items = await sap.getAllParallel<SapItemEx>(
        `Items?$filter=${ITEMS_FILTER}&$select=${ITEMS_SELECT_BASE}`,
        `Items/$count?$filter=${ITEMS_FILTER}`,
        { pageSize: 500, env: "prod" },
      );
    }

    // ── 3. Mapping en mémoire (skip invalid/frozen, ceinture-bretelles) ──
    let synced = 0;
    let skipped = 0;
    const errorSamples: string[] = [];
    const CHUNK = 30;          // chunk des écritures Prisma résiduelles (lots)
    const SQL_BATCH = 200;     // lignes par requête bulk raw SQL

    const valid = items.filter((it) => it.Valid !== "tNO" && it.Frozen !== "tYES");
    skipped = items.length - valid.length;

    const productRows = valid.map((it) => {
      const groupCode = it.ItemsGroupCode ?? null;
      const isPackaging = groupCode != null && (
        PACKAGING_GROUP_CODES.has(groupCode) || NOISE_GROUP_CODES.has(groupCode)
      );
      return {
        itemCode: it.ItemCode,
        itemName: it.ItemName,
        itemGroup: groupCode,
        groupName: groupCode != null ? groupNameById.get(groupCode) ?? null : null,
        salesUnit: it.SalesUnit ?? null,
        salesPackagingUnit: it.SalesPackagingUnit ?? null,
        salesQtyPerPackUnit: it.SalesQtyPerPackUnit ?? null,
        salesItemsPerUnit: it.SalesItemsPerUnit ?? null,   // raw SQL uniquement
        salesUnitWeight: it.SalesUnitWeight ?? null,
        inventoryUnit: it.InventoryUOM ?? null,
        purchaseUnit: it.PurchaseUnit ?? null,
        manageBatch: it.ManageBatchNumbers === "tYES",
        isPackaging,
        totalStock: it.QuantityOnStock ?? 0,
        // Champs custom Gervifrais
        uPays: it.U_Pays ?? null,
        uMarque: it.U_GER_Marque ?? null,
        uCondi: it.U_GER_Det_Condt ?? null,
        uCalibre: it.U_GER_CALIBRE ?? null,
        uUvc: it.U_GER_UVC ?? null,
        frgnName: it.ForeignName ?? it.FrgnName ?? null,   // = variété (SL: ForeignName)
        uNbBarqColis: it.U_GER_NB_BARQ_COLIS ?? null,
        stocks: (it.ItemWarehouseInfoCollection ?? []).filter((w) =>
          WAREHOUSES_TO_SYNC.has(w.WarehouseCode),
        ),
      };
    });

    // ── 4. Upserts BULK (modèle scripts/backfill-docs.mjs) ──
    // a) createMany skipDuplicates pour les NOUVEAUX produits (id cuid généré
    //    par Prisma — un INSERT raw devrait fournir l'id lui-même).
    //    `salesItemsPerUnit` est volontairement ABSENT ici : la colonne existe
    //    en base mais pas dans le client Prisma généré → raw SQL en (b).
    // b) UPDATE bulk ... FROM (VALUES …) pour TOUTES les lignes (nouvelles
    //    comprises) — porte aussi salesItemsPerUnit.
    try {
      for (let i = 0; i < productRows.length; i += SQL_BATCH) {
        const slice = productRows.slice(i, i + SQL_BATCH);
        await prisma.product.createMany({
          data: slice.map(({ stocks: _s, salesItemsPerUnit: _u, ...data }) => data),
          skipDuplicates: true,
        });
      }

      // UPDATE bulk — casts explicites obligatoires : dans un FROM (VALUES …)
      // paramétré, Postgres ne peut pas inférer les types des colonnes.
      const P_COLS =
        `"itemCode","itemName","itemGroup","groupName","salesUnit","salesPackagingUnit",` +
        `"salesQtyPerPackUnit","salesItemsPerUnit","salesUnitWeight","inventoryUnit","purchaseUnit",` +
        `"manageBatch","isPackaging","totalStock","uPays","uMarque","uCondi","uCalibre","uUvc","frgnName","uNbBarqColis"`;
      const P_CASTS = [
        "text", "text", "int", "text", "text", "text",
        "float8", "float8", "float8", "text", "text",
        "boolean", "boolean", "float8", "text", "text", "text", "text", "text", "text", "float8",
      ];
      for (let i = 0; i < productRows.length; i += SQL_BATCH) {
        const slice = productRows.slice(i, i + SQL_BATCH);
        const values: string[] = [];
        const params: unknown[] = [];
        let p = 1;
        for (const r of slice) {
          const row = [
            r.itemCode, r.itemName, r.itemGroup, r.groupName, r.salesUnit, r.salesPackagingUnit,
            r.salesQtyPerPackUnit, r.salesItemsPerUnit, r.salesUnitWeight, r.inventoryUnit, r.purchaseUnit,
            r.manageBatch, r.isPackaging, r.totalStock, r.uPays, r.uMarque, r.uCondi, r.uCalibre, r.uUvc, r.frgnName, r.uNbBarqColis,
          ];
          values.push(`(${row.map((_, k) => `$${p++}::${P_CASTS[k]}`).join(",")})`);
          params.push(...row);
        }
        await prisma.$executeRawUnsafe(
          `UPDATE "Product" AS pr SET
             "itemName"=v."itemName","itemGroup"=v."itemGroup","groupName"=v."groupName",
             "salesUnit"=v."salesUnit","salesPackagingUnit"=v."salesPackagingUnit",
             "salesQtyPerPackUnit"=v."salesQtyPerPackUnit","salesItemsPerUnit"=v."salesItemsPerUnit",
             "salesUnitWeight"=v."salesUnitWeight","inventoryUnit"=v."inventoryUnit",
             "purchaseUnit"=v."purchaseUnit","manageBatch"=v."manageBatch",
             "isPackaging"=v."isPackaging","totalStock"=v."totalStock",
             "uPays"=v."uPays","uMarque"=v."uMarque","uCondi"=v."uCondi","uCalibre"=v."uCalibre",
             "uUvc"=v."uUvc","frgnName"=v."frgnName","uNbBarqColis"=v."uNbBarqColis","syncedAt"=NOW()
           FROM (VALUES ${values.join(",")}) AS v(${P_COLS})
           WHERE pr."itemCode" = v."itemCode"`,
          ...params,
        );
      }

      // c) ProductStock — résolution productId puis même technique :
      //    createMany skipDuplicates (nouvelles paires productId/warehouse,
      //    id cuid via Prisma) + UPDATE bulk FROM VALUES pour les valeurs.
      const allProductsNow = await prisma.product.findMany({
        where: { itemCode: { in: productRows.map((r) => r.itemCode) } },
        select: { id: true, itemCode: true },
      });
      const idByCode = new Map(allProductsNow.map((e) => [e.itemCode, e.id]));

      const stockRows = productRows.flatMap((r) => {
        const productId = idByCode.get(r.itemCode);
        if (!productId) return [];
        return r.stocks.map((w) => {
          const inStock = w.InStock ?? 0;
          const committed = w.Committed ?? 0;
          return {
            productId,
            warehouse: w.WarehouseCode,
            inStock,
            committed,
            ordered: w.Ordered ?? 0,
            available: inStock - committed,
          };
        });
      });

      for (let i = 0; i < stockRows.length; i += SQL_BATCH) {
        const slice = stockRows.slice(i, i + SQL_BATCH);
        await prisma.productStock.createMany({ data: slice, skipDuplicates: true });

        const values: string[] = [];
        const params: unknown[] = [];
        let p = 1;
        const S_CASTS = ["text", "text", "float8", "float8", "float8", "float8"];
        for (const s of slice) {
          const row = [s.productId, s.warehouse, s.inStock, s.committed, s.ordered, s.available];
          values.push(`(${row.map((_, k) => `$${p++}::${S_CASTS[k]}`).join(",")})`);
          params.push(...row);
        }
        await prisma.$executeRawUnsafe(
          `UPDATE "ProductStock" AS st SET
             "inStock"=v."inStock","committed"=v."committed","ordered"=v."ordered",
             "available"=v."available","syncedAt"=NOW()
           FROM (VALUES ${values.join(",")}) AS v("productId","warehouse","inStock","committed","ordered","available")
           WHERE st."productId" = v."productId" AND st."warehouse" = v."warehouse"`,
          ...params,
        );
      }

      synced = productRows.length;
    } catch (e) {
      errorSamples.push(`Bulk products: ${(e as Error).message}`);
    }

    // ── 5. Sync batches for batch-managed products ──────────
    // SAP B1 a BatchNumberDetails (1 row par lot). Pour le prix d'achat,
    // on enrichit via PurchaseDeliveryNotes filtré par ItemCode (best effort).
    let batchSynced = 0;
    try {
      const batches = await sap.getAll<SapBatchDetail>(
        "BatchNumberDetails?$select=ItemCode,Batch,Status,AdmissionDate,ManufacturingDate,ExpirationDate,SystemNumber,DocEntry",
        { pageSize: 500, env: "prod" },
      );

      // Build product id map for fast lookup
      const allProducts = await prisma.product.findMany({
        where: { manageBatch: true },
        select: { id: true, itemCode: true },
      });
      const productIdByCode = new Map(allProducts.map((p) => [p.itemCode, p.id]));

      // Bulk upsert batches (chunks de 30)
      for (let i = 0; i < batches.length; i += CHUNK) {
        const slice = batches.slice(i, i + CHUNK);
        await Promise.all(slice.map(async (b) => {
          const productId = productIdByCode.get(b.ItemCode);
          if (!productId) return;
          // Best-effort warehouse (we keep null if not provided in BatchNumberDetails)
          await prisma.productBatch.upsert({
            where: {
              productId_batchNumber_warehouseCode: {
                productId,
                batchNumber: b.Batch,
                warehouseCode: "",
              },
            },
            update: {
              status: b.Status ?? null,
              admissionDate: b.AdmissionDate ? new Date(b.AdmissionDate) : null,
              manufactureDate: b.ManufacturingDate ? new Date(b.ManufacturingDate) : null,
              expirationDate: b.ExpirationDate ? new Date(b.ExpirationDate) : null,
              sapSystemNumber: b.SystemNumber ?? null,
              sapDocEntry: b.DocEntry ?? null,
              syncedAt: new Date(),
            },
            create: {
              productId,
              batchNumber: b.Batch,
              warehouseCode: "",
              status: b.Status ?? null,
              admissionDate: b.AdmissionDate ? new Date(b.AdmissionDate) : null,
              manufactureDate: b.ManufacturingDate ? new Date(b.ManufacturingDate) : null,
              expirationDate: b.ExpirationDate ? new Date(b.ExpirationDate) : null,
              sapSystemNumber: b.SystemNumber ?? null,
              sapDocEntry: b.DocEntry ?? null,
            },
          });
          batchSynced++;
        }));
      }
    } catch (e) {
      // Batch sync errors aren't fatal — log to errors but don't fail the whole sync
      errorSamples.push(`Batch sync: ${(e as Error).message}`);
    }

    // ── 6. Enrich batches with purchase price ───────────────
    // Best-effort: fetch recent PurchaseDeliveryNotes (limit 100), match lines'
    // BatchNumbers arrays against our ProductBatch records to recover the price.
    let priceEnriched = 0;
    try {
      type PDNLine = { ItemCode: string; Price?: number; Currency?: string;
        BatchNumbers?: { BatchNumber: string; Quantity?: number }[] };
      type PDN = { DocEntry: number; DocNum?: string | number; DocDate?: string;
        CardName?: string; DocumentLines: PDNLine[] };
      const pdns = await sap.getAll<PDN>(
        "PurchaseDeliveryNotes?$top=100&$orderby=DocEntry desc&$select=DocEntry,DocNum,DocDate,CardName,DocumentLines",
        { pageSize: 100, maxPages: 1, env: "prod" },
      );
      // Build a map: (itemCode|batchNumber) → { price, currency, supplier, docNum }
      const priceMap = new Map<string, { price: number; currency?: string; supplier?: string; docNum?: string }>();
      for (const pdn of pdns) {
        for (const line of pdn.DocumentLines ?? []) {
          if (line.Price == null || line.Price <= 0) continue;
          for (const bn of line.BatchNumbers ?? []) {
            if (!bn.BatchNumber) continue;
            const key = `${line.ItemCode}|${bn.BatchNumber}`;
            // First match wins (most recent PDN since we sort DESC by DocEntry)
            if (!priceMap.has(key)) {
              priceMap.set(key, {
                price: line.Price,
                currency: line.Currency,
                supplier: pdn.CardName,
                docNum: pdn.DocNum != null ? String(pdn.DocNum) : undefined,
              });
            }
          }
        }
      }

      // Update matching ProductBatch rows
      if (priceMap.size > 0) {
        // Re-load batches with their itemCode to do the matching
        const allBatches = await prisma.productBatch.findMany({
          select: { id: true, batchNumber: true, product: { select: { itemCode: true } } },
        });
        const updates = [];
        for (const b of allBatches) {
          const found = priceMap.get(`${b.product.itemCode}|${b.batchNumber}`);
          if (!found) continue;
          updates.push(prisma.productBatch.update({
            where: { id: b.id },
            data: {
              purchasePrice: found.price,
              currency: found.currency ?? null,
              supplierName: found.supplier ?? null,
              sourceDocNum: found.docNum ?? null,
            },
          }));
        }
        // Run in chunks of 30
        for (let i = 0; i < updates.length; i += CHUNK) {
          await Promise.all(updates.slice(i, i + CHUNK));
        }
        priceEnriched = updates.length;
      }
    } catch (e) {
      errorSamples.push(`Price enrichment: ${(e as Error).message}`);
    }

    const finishedAt = new Date();
    await prisma.syncLog.update({
      where: { id: log.id },
      data: {
        status: "success",
        finishedAt,
        itemsTotal: items.length,
        itemsSynced: synced,
        itemsSkipped: skipped,
        durationMs: finishedAt.getTime() - startedAt.getTime(),
        errors: errorSamples.length ? JSON.stringify(errorSamples) : null,
      },
    });

    return NextResponse.json({
      ok: true,
      total: items.length,
      synced,
      skipped,
      batchSynced,
      priceEnriched,
      durationMs: finishedAt.getTime() - startedAt.getTime(),
      errors: errorSamples,
    });
  } catch (e) {
    const finishedAt = new Date();
    const message = e instanceof Error ? e.message : String(e);
    await prisma.syncLog.update({
      where: { id: log.id },
      data: {
        status: "error",
        finishedAt,
        durationMs: finishedAt.getTime() - startedAt.getTime(),
        errors: JSON.stringify({ message }),
      },
    });
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

/** GET /api/sap/sync/products → last sync info */
export async function GET() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

  const last = await prisma.syncLog.findFirst({
    where: { source: "sap", type: "products" },
    orderBy: { startedAt: "desc" },
  });

  const totalProducts = await prisma.product.count();
  const productsWithStock = await prisma.product.count({
    where: {
      isPackaging: false,
      stocks: { some: { available: { gt: 0 } } },
    },
  });

  return NextResponse.json({ last, totalProducts, productsWithStock });
}
