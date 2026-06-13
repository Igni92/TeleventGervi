import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import {
  getRecipe, getFamilyItems, resolveLotsForItems, lastSalePricePie, packRatio, LOT_PENDING,
} from "@/lib/fabrication";
import { uniteGestion } from "@/lib/fabrication-optim";

/**
 * GET /api/fabrication/options?parent=DECO16&warehouse=01
 *
 * Prépare l'écran « Fabriquer » pour une recette : pour CHAQUE famille de la
 * recette, les articles concrets de cette famille avec :
 *   - chips marque / condi / origine,
 *   - stock dispo en COLIS par entrepôt (000 / 01 / R1),
 *   - lot proposé (FIFO ProductBatch, sinon dernier BR du miroir → EM<DocNum>),
 *   - prix d'achat €/colis (pour le coût estimé),
 *   - drapeau « à découvert » si dispo ≤ 0 dans l'entrepôt choisi
 *     (le run posera alors le sentinel EM_PENDING — lot affecté à réception).
 *
 * Renvoie aussi la valeur estimée du parent (dernier prix de vente €/colis).
 */

const WHITELIST_WHS = new Set(["000", "01", "R1"]);

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const parent = searchParams.get("parent")?.trim();
  const warehouse = searchParams.get("warehouse")?.trim() || "01";
  if (!parent) return NextResponse.json({ error: "parent requis" }, { status: 400 });
  if (!WHITELIST_WHS.has(warehouse)) {
    return NextResponse.json({ error: `Entrepôt invalide : ${warehouse}` }, { status: 400 });
  }

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

  // Articles concrets par famille + lots en batch.
  const familyKeys = recipe.components.map((c) => c.familyKey);
  const itemsByFamily = await getFamilyItems(familyKeys);
  const allCodes = Array.from(itemsByFamily.values()).flat().map((i) => i.itemCode);
  const lots = await resolveLotsForItems(allCodes, warehouse);

  const families = recipe.components.map((c) => {
    const items = (itemsByFamily.get(c.familyKey) ?? []).map((it) => {
      const lot = lots.get(it.itemCode);
      const availHere = it.availColis[warehouse] ?? 0;
      const decouvert = availHere <= 0;
      const batchNumber = decouvert || !lot?.batchNumber ? LOT_PENDING : lot.batchNumber;
      const priceColis = lot?.pricePie != null ? Math.round(lot.pricePie * it.ratio * 100) / 100 : null;
      return {
        ...it,
        decouvert,
        lot: {
          batchNumber,
          pending: batchNumber === LOT_PENDING,
          priceColis,                       // €/colis (estimation marge, même à découvert)
          source: lot?.source ?? null,
          supplierName: lot?.supplierName ?? null,
        },
      };
    });
    return {
      familyKey: c.familyKey,
      familyLabel: c.familyLabel,
      qtyColisPerTour: c.qtyColis,
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
    },
    recipe: { parentQty: recipe.parentQty, costs: recipe.costs },
    warehouse,
    families,
  });
}
