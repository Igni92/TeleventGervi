/**
 * Fabrication v2 — helpers serveur partagés entre :
 *   - /api/fabrication/recipes  (recettes par famille + ratio parentQty)
 *   - /api/fabrication/options  (articles concrets + lot proposé par famille)
 *   - /api/sap/assembly         (run de production : exits + entrée, lots tracés)
 *
 * Conventions métier :
 *   • TOUT s'exprime en COLIS côté UI/API (jamais pie/barquette).
 *   • Lot = chaîne "EM<DocNum>" (règle Gervifrais, cf. lib/lotResolver) OU le
 *     sentinel EM_PENDING (vente/fabrication à découvert : le lot sera affecté
 *     à la prochaine entrée marchandise).
 *   • Résolution lot+prix : ProductBatch FIFO (admissionDate ASC) si la table
 *     est alimentée, sinon le MIROIR des bons de réception (SapPdnLine — c'est
 *     le cas réel sur cette base : aucun article n'est batch-managed dans SAP,
 *     les lots vivent en U_NoLot).
 *   • prix d'achat : les sources SAP sont PAR PIE → on convertit en €/COLIS
 *     via le ratio salesQtyPerPackUnit (kg → ratio 1).
 *
 * ⚠️ Tables FabricationRun/FabricationRunLine et colonne ProductionRecipe.parentQty
 *    accédées en RAW SQL uniquement (client Prisma non régénéré).
 */
import { prisma } from "@/lib/prisma";
import { LOT_PENDING } from "@/lib/lotResolver";
import { uniteGestion, type UniteGestion } from "@/lib/fabrication-optim";

export { LOT_PENDING };

// ── Types partagés ────────────────────────────────────────────────────
export type RecipeComponent = { familyKey: string; familyLabel: string; qtyColis: number };
export type RecipeCost = { label: string; costPerColis: number };
export type RecipeFull = {
  parentItemCode: string;
  parentQty: number;            // colis de parent produits par « tour »
  components: RecipeComponent[];
  costs: RecipeCost[];
};

export type LotResolution = {
  /** "EM<DocNum>" si trouvé, sinon null (l'appelant décide EM_PENDING). */
  batchNumber: string | null;
  /** € par PIE (convention SAP) — null si inconnu. */
  pricePie: number | null;
  /** D'où vient l'info : lot local FIFO, miroir BR, ou rien. */
  source: "batch" | "pdn" | null;
  supplierName: string | null;
};

/** Ratio colis→pie d'un produit (kg → 1, comme unitInfo de gervifrais-calc). */
export function packRatio(salesUnit: string | null | undefined, salesQtyPerPackUnit: number | null | undefined): number {
  if (/kg|kilo/i.test((salesUnit ?? "").trim())) return 1;
  return salesQtyPerPackUnit && salesQtyPerPackUnit > 1 ? salesQtyPerPackUnit : 1;
}

// ── Conditionnement COLIS : nb colis EXACT + poids d'un colis ──────────
// Logique PURE déportée dans lib/colis.ts (testable hors-ligne, sans Prisma) ;
// ré-exportée ici pour rester découvrable à côté de `packRatio`.
export { colisInfo, type ColisInfo, type ProductColisFields } from "@/lib/colis";

// ── Recette complète (avec parentQty — raw SQL) ───────────────────────
export async function getRecipe(parentItemCode: string): Promise<RecipeFull | null> {
  const heads = await prisma.$queryRawUnsafe<{ id: string; parentQty: number }[]>(
    `SELECT "id", "parentQty" FROM "ProductionRecipe" WHERE "parentItemCode" = $1 LIMIT 1;`,
    parentItemCode,
  );
  if (heads.length === 0) return null;
  const { id, parentQty } = heads[0];
  const [components, costs] = await Promise.all([
    prisma.$queryRawUnsafe<RecipeComponent[]>(
      `SELECT "familyKey", "familyLabel", "qtyColis" FROM "ProductionRecipeComponent"
        WHERE "recipeId" = $1 ORDER BY "position" ASC, "familyLabel" ASC;`,
      id,
    ),
    prisma.$queryRawUnsafe<RecipeCost[]>(
      `SELECT "label", "costPerColis" FROM "ProductionRecipeCost"
        WHERE "recipeId" = $1 ORDER BY "position" ASC;`,
      id,
    ),
  ]);
  return {
    parentItemCode,
    parentQty: Number(parentQty) || 1,
    components: components.map((c) => ({ ...c, qtyColis: Number(c.qtyColis) })),
    costs: costs.map((c) => ({ ...c, costPerColis: Number(c.costPerColis) })),
  };
}

// ── Résolution lot + prix d'achat (batched : N articles en 3 requêtes) ─
export async function resolveLotsForItems(
  itemCodes: string[],
  warehouseCode: string,
): Promise<Map<string, LotResolution>> {
  const out = new Map<string, LotResolution>();
  const codes = Array.from(new Set(itemCodes.filter(Boolean)));
  if (codes.length === 0) return out;

  // 1. Lot local FIFO (plus VIEUX lot encore en stock) — si ProductBatch alimentée.
  type BatchRow = { itemCode: string; batchNumber: string; purchasePrice: number | null; supplierName: string | null };
  const batches = await prisma.$queryRawUnsafe<BatchRow[]>(
    `SELECT DISTINCT ON (p."itemCode")
            p."itemCode", b."batchNumber", b."purchasePrice", b."supplierName"
       FROM "ProductBatch" b
       JOIN "Product" p ON p."id" = b."productId"
      WHERE p."itemCode" = ANY($1::text[]) AND b."quantity" > 0
        AND (b."warehouseCode" = $2 OR b."warehouseCode" IS NULL OR b."warehouseCode" = '')
      ORDER BY p."itemCode", b."admissionDate" ASC NULLS LAST, b."batchNumber" ASC;`,
    codes, warehouseCode,
  );
  for (const b of batches) {
    out.set(b.itemCode, {
      batchNumber: b.batchNumber,
      pricePie: b.purchasePrice != null ? Number(b.purchasePrice) : null,
      source: "batch",
      supplierName: b.supplierName,
    });
  }

  // 2. Miroir des bons de réception : DERNIER BR contenant l'article
  //    (même règle que lib/lotResolver : U_NoLot = EM<DocNum du dernier PDN>).
  //    Même entrepôt prioritaire, sinon n'importe lequel.
  type PdnRow = { itemCode: string; docNum: number | null; cardName: string | null; lineTotal: number; quantity: number };
  const pdnSql = (withWhs: boolean) => `
    SELECT DISTINCT ON (l."itemCode")
           l."itemCode", n."docNum", n."cardName", l."lineTotal", l."quantity"
      FROM "SapPdnLine" l
      JOIN "SapPurchaseDeliveryNote" n ON n."docEntry" = l."docEntry"
     WHERE l."itemCode" = ANY($1::text[]) AND n."cancelled" = false AND l."quantity" > 0
       ${withWhs ? `AND l."warehouseCode" = $2` : ""}
     ORDER BY l."itemCode", n."docDate" DESC, n."docEntry" DESC;`;
  const missing1 = codes.filter((c) => !out.has(c));
  if (missing1.length > 0) {
    const whsRows = await prisma.$queryRawUnsafe<PdnRow[]>(pdnSql(true), missing1, warehouseCode);
    const anyRows = await prisma.$queryRawUnsafe<PdnRow[]>(pdnSql(false), missing1);
    const pick = new Map<string, PdnRow>();
    for (const r of anyRows) pick.set(r.itemCode, r);
    for (const r of whsRows) pick.set(r.itemCode, r); // priorité même entrepôt
    for (const r of Array.from(pick.values())) {
      if (r.docNum == null) continue;
      const qty = Number(r.quantity);
      out.set(r.itemCode, {
        batchNumber: `EM${r.docNum}`,
        pricePie: qty > 0 ? Number(r.lineTotal) / qty : null,
        source: "pdn",
        supplierName: r.cardName,
      });
    }
  }

  // 3. Rien trouvé → résolution vide (l'appelant posera EM_PENDING).
  for (const c of codes) {
    if (!out.has(c)) out.set(c, { batchNumber: null, pricePie: null, source: null, supplierName: null });
  }
  return out;
}

/** Variante mono-article (run de fabrication). */
export async function resolveLotAndPrice(itemCode: string, warehouseCode: string): Promise<LotResolution> {
  const map = await resolveLotsForItems([itemCode], warehouseCode);
  return map.get(itemCode) ?? { batchNumber: null, pricePie: null, source: null, supplierName: null };
}

// ── Valeur du parent : dernier prix de VENTE connu (miroir Orders) ────
/** € par PIE du dernier prix vendu pour cet article — null si jamais vendu. */
export async function lastSalePricePie(itemCode: string): Promise<number | null> {
  const rows = await prisma.$queryRawUnsafe<{ lineTotal: number; quantity: number }[]>(
    `SELECT l."lineTotal", l."quantity"
       FROM "SapOrderLine" l
       JOIN "SapOrder" o ON o."docEntry" = l."docEntry"
      WHERE l."itemCode" = $1 AND o."cancelled" = false AND l."quantity" > 0 AND l."lineTotal" > 0
      ORDER BY o."docDate" DESC, o."docEntry" DESC
      LIMIT 1;`,
    itemCode,
  );
  if (rows.length === 0) return null;
  const qty = Number(rows[0].quantity);
  return qty > 0 ? Number(rows[0].lineTotal) / qty : null;
}

// ── Articles concrets d'une liste de familles, avec stock par entrepôt ─
export type FamilyItemOption = {
  familyKey: string;
  itemCode: string;
  itemName: string;
  uMarque: string | null;
  uCondi: string | null;
  uPays: string | null;
  manageBatch: boolean;
  /** ratio colis→pie */
  ratio: number;
  /** unité de gestion réelle (kg / colis / barquette) + quantité physique par colis */
  unite: UniteGestion;
  /** dispo en COLIS par entrepôt (000/01/R1) + total */
  availColis: Record<string, number>;
  availTotal: number;
};

export async function getFamilyItems(familyKeys: string[]): Promise<Map<string, FamilyItemOption[]>> {
  if (familyKeys.length === 0) return new Map();
  // CTE familles (même CASE que lib/familles.FAMILY_CTE_SQL — dupliquée ici en
  // unsafe paramétré car FAMILY_CTE_SQL est un Prisma.Sql non composable avec
  // $queryRawUnsafe). DOIT rester synchrone avec lib/familles.ts.
  type Row = {
    familyKey: string; itemCode: string; itemName: string;
    uMarque: string | null; uCondi: string | null; uPays: string | null;
    manageBatch: boolean; salesUnit: string | null; salesQtyPerPackUnit: number | null;
    salesItemsPerUnit: number | null; salesUnitWeight: number | null; inventoryUnit: string | null;
    warehouse: string | null; available: number | null;
  };
  const rows = await prisma.$queryRawUnsafe<Row[]>(
    `WITH fam AS (
       SELECT p."itemCode", p."itemName", p."uMarque", p."uCondi", p."uPays",
              p."manageBatch", p."salesUnit", p."salesQtyPerPackUnit", p."id",
              p."salesItemsPerUnit", p."salesUnitWeight", p."inventoryUnit",
              CASE
                WHEN UPPER(p."itemName") LIKE '%MYRTILLE%'  THEN 'myrtille'
                WHEN UPPER(p."itemName") LIKE '%GROSEILLE%' THEN 'groseille'
                WHEN UPPER(p."itemName") LIKE '%FRAMBOISE%' THEN 'framboise'
                WHEN UPPER(p."itemName") LIKE '%CASSIS%'    THEN 'cassis'
                WHEN UPPER(p."itemName") LIKE '%MURE%'
                  OR UPPER(p."itemName") LIKE '%MÛRE%'      THEN 'mure'
                WHEN UPPER(p."itemName") LIKE '%FRAISE%'    THEN 'fraise'
                ELSE 'g_' || COALESCE(p."itemGroup"::text, 'na')
              END AS "familyKey"
         FROM "Product" p
        WHERE p."isPackaging" = false AND p."isKit" = false
     )
     SELECT f."familyKey", f."itemCode", f."itemName", f."uMarque", f."uCondi", f."uPays",
            f."manageBatch", f."salesUnit", f."salesQtyPerPackUnit",
            f."salesItemsPerUnit", f."salesUnitWeight", f."inventoryUnit",
            s."warehouse", s."available"
       FROM fam f
       LEFT JOIN "ProductStock" s ON s."productId" = f."id"
      WHERE f."familyKey" = ANY($1::text[])
      ORDER BY f."itemName" ASC, f."itemCode" ASC;`,
    familyKeys,
  );

  const byItem = new Map<string, FamilyItemOption>();
  for (const r of rows) {
    let it = byItem.get(r.itemCode);
    if (!it) {
      it = {
        familyKey: r.familyKey,
        itemCode: r.itemCode,
        itemName: r.itemName,
        uMarque: r.uMarque,
        uCondi: r.uCondi,
        uPays: r.uPays,
        manageBatch: r.manageBatch,
        ratio: packRatio(r.salesUnit, r.salesQtyPerPackUnit != null ? Number(r.salesQtyPerPackUnit) : null),
        unite: uniteGestion({
          salesUnit: r.salesUnit,
          inventoryUnit: r.inventoryUnit,
          salesUnitWeight: r.salesUnitWeight != null ? Number(r.salesUnitWeight) : null,
          salesQtyPerPackUnit: r.salesQtyPerPackUnit != null ? Number(r.salesQtyPerPackUnit) : null,
          salesItemsPerUnit: r.salesItemsPerUnit != null ? Number(r.salesItemsPerUnit) : null,
        }),
        availColis: { "000": 0, "01": 0, R1: 0 },
        availTotal: 0,
      };
      byItem.set(r.itemCode, it);
    }
    if (r.warehouse && r.available != null) {
      // pie → colis, plancher à 0, arrondi 1 décimale (comme Ecran2Order)
      const colis = Math.max(0, Math.floor((Number(r.available) / it.ratio) * 10) / 10);
      it.availColis[r.warehouse] = colis;
    }
  }

  const out = new Map<string, FamilyItemOption[]>();
  for (const it of Array.from(byItem.values())) {
    it.availTotal = Math.round((["000", "01", "R1"].reduce((s, w) => s + (it.availColis[w] ?? 0), 0)) * 10) / 10;
    const arr = out.get(it.familyKey) ?? [];
    arr.push(it);
    out.set(it.familyKey, arr);
  }
  // Tri : dispo total desc, puis nom — les articles en stock remontent.
  for (const arr of Array.from(out.values())) {
    arr.sort((a, b) => b.availTotal - a.availTotal || a.itemName.localeCompare(b.itemName));
  }
  return out;
}
