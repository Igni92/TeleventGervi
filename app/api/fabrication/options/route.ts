import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getAccessScope } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import {
  getRecipe, getFamilyItems, resolveLotsForItems, lastSalePricePie, packRatio, LOT_PENDING,
  type LotResolution,
} from "@/lib/fabrication";
import { uniteGestion } from "@/lib/fabrication-optim";

/**
 * GET /api/fabrication/options?parent=DECO16
 *
 * Prépare l'écran « Fabriquer » pour une recette : pour CHAQUE famille de la
 * recette (quantité par tour en unités de base — v3 — ou en colis — legacy),
 * les articles concrets de cette famille avec :
 *   - chips marque / condi / origine,
 *   - stock dispo par MAGASIN (000 / 01 / R1), en colis ET en unités de base,
 *   - lot proposé PAR MAGASIN (FIFO ProductBatch, sinon dernier BR du miroir
 *     → EM<DocNum> ; à découvert dans ce magasin → sentinel EM_PENDING),
 *   - prix d'achat €/colis (pour le coût estimé).
 *
 * Multi-magasins : le client choisit librement le magasin SOURCE de chaque
 * composant et le magasin d'ENTRÉE du produit fini — d'où les lots résolus
 * pour les 3 magasins d'un coup (pas de rechargement au changement de magasin).
 *
 * Renvoie aussi la valeur estimée du parent (dernier prix de vente €/colis).
 */

const ALL_WHS = ["000", "01", "R1"] as const;

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

  // Coûts d'achat (€/colis composant) et lignes de coût recette → admins seuls.
  const admin = (await getAccessScope(session)).all;

  const { searchParams } = new URL(req.url);
  const parent = searchParams.get("parent")?.trim();
  if (!parent) return NextResponse.json({ error: "parent requis" }, { status: 400 });

  const recipe = await getRecipe(parent);
  if (!recipe || recipe.components.length === 0) {
    return NextResponse.json({ error: `Aucune recette pour "${parent}".` }, { status: 404 });
  }

  // Méta parent : ratio colis→pie, unité de gestion réelle + dernier prix de vente.
  const parentRows = await prisma.$queryRawUnsafe<
    {
      itemName: string; salesUnit: string | null; salesQtyPerPackUnit: number | null;
      salesItemsPerUnit: number | null; salesUnitWeight: number | null; inventoryUnit: string | null;
    }[]
  >(
    `SELECT "itemName", "salesUnit", "salesQtyPerPackUnit",
            "salesItemsPerUnit", "salesUnitWeight", "inventoryUnit"
       FROM "Product" WHERE "itemCode" = $1 LIMIT 1;`,
    parent,
  );
  if (parentRows.length === 0) {
    return NextResponse.json({ error: `Produit "${parent}" introuvable.` }, { status: 404 });
  }
  const parentMeta = parentRows[0];
  const parentRatio = packRatio(parentMeta.salesUnit, parentMeta.salesQtyPerPackUnit != null ? Number(parentMeta.salesQtyPerPackUnit) : null);
  const parentUnite = uniteGestion({
    salesUnit: parentMeta.salesUnit,
    inventoryUnit: parentMeta.inventoryUnit,
    salesUnitWeight: parentMeta.salesUnitWeight != null ? Number(parentMeta.salesUnitWeight) : null,
    salesQtyPerPackUnit: parentMeta.salesQtyPerPackUnit != null ? Number(parentMeta.salesQtyPerPackUnit) : null,
    salesItemsPerUnit: parentMeta.salesItemsPerUnit != null ? Number(parentMeta.salesItemsPerUnit) : null,
  });
  const salePie = await lastSalePricePie(parent);
  const parentSaleColis = salePie != null ? Math.round(salePie * parentRatio * 100) / 100 : null;

  // Stock du PARENT par magasin (unités de base, SIGNÉ) : permet à l'UI
  // d'annoncer AVANT validation que l'entrée comblera un découvert (dispo < 0,
  // vente à découvert) — même répartition que le serveur (repartitionEntree).
  const parentStockRows = await prisma.$queryRawUnsafe<{ warehouse: string; available: number }[]>(
    `SELECT s."warehouse", COALESCE(s."available", 0) AS "available"
       FROM "Product" p JOIN "ProductStock" s ON s."productId" = p."id"
      WHERE p."itemCode" = $1;`,
    parent,
  );
  const parentAvailUnits: Record<string, number> = { "000": 0, "01": 0, R1: 0 };
  for (const r of parentStockRows) {
    if (r.warehouse in parentAvailUnits) parentAvailUnits[r.warehouse] = Math.round(Number(r.available) * 1000) / 1000;
  }

  // Articles concrets par famille + lots résolus pour CHAQUE magasin.
  const familyKeys = recipe.components.map((c) => c.familyKey);
  const itemsByFamily = await getFamilyItems(familyKeys);
  const allCodes = Array.from(itemsByFamily.values()).flat().map((i) => i.itemCode);
  const lotsByWhs = new Map<string, Map<string, LotResolution>>();
  await Promise.all(ALL_WHS.map(async (whs) => {
    lotsByWhs.set(whs, await resolveLotsForItems(allCodes, whs));
  }));

  const families = recipe.components.map((c) => {
    const items = (itemsByFamily.get(c.familyKey) ?? []).map((it) => {
      // Lot proposé par magasin : à découvert DANS CE MAGASIN → EM_PENDING.
      const lots: Record<string, {
        batchNumber: string; pending: boolean; priceColis?: number | null;
        source: string | null; supplierName: string | null;
      }> = {};
      for (const whs of ALL_WHS) {
        const lot = lotsByWhs.get(whs)?.get(it.itemCode);
        const decouvert = (it.availUnits[whs] ?? 0) <= 0;
        const batchNumber = decouvert || !lot?.batchNumber ? LOT_PENDING : lot.batchNumber;
        const priceColis = lot?.pricePie != null ? Math.round(lot.pricePie * it.ratio * 100) / 100 : null;
        lots[whs] = {
          batchNumber,
          pending: batchNumber === LOT_PENDING,
          priceColis: admin ? priceColis : undefined, // €/colis coût — admins seuls
          source: lot?.source ?? null,
          supplierName: lot?.supplierName ?? null,
        };
      }
      return { ...it, lots };
    });
    return {
      familyKey: c.familyKey,
      familyLabel: c.familyLabel,
      /** Quantité par tour, exprimée selon `mode` ("unite" v3 / "colis" legacy). */
      qtyPerTour: c.qty,
      mode: c.mode,
      items,
    };
  });

  return NextResponse.json({
    ok: true,
    parent: {
      itemCode: parent,
      itemName: parentMeta.itemName,
      ratio: parentRatio,
      unite: parentUnite,                  // unité de gestion réelle (kg/colis/barquette)
      lastSalePriceColis: parentSaleColis, // €/colis — null si jamais vendu
      availUnits: parentAvailUnits,        // stock par magasin, SIGNÉ (découvert < 0)
    },
    recipe: { parentQty: recipe.parentQty, costs: admin ? recipe.costs : [] },
    families,
  });
}
