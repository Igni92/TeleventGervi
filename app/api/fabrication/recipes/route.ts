import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getRecipe } from "@/lib/fabrication";

/**
 * Recettes de fabrication v3 — par FAMILLE, quantités en UNITÉS DE BASE :
 *   parentQty colis de produit fini = Σ composants, chaque ligne portant
 *   { qty, mode } : mode "unite" (barquettes fruits / kg au poids — défaut)
 *   ou "colis" (lignes historiques v2).
 *   Ex. 1 DECO16 = 6 barquettes groseille + 5 barquettes mûre + 5 barquettes myrtille.
 *
 * GET  /api/fabrication/recipes?list=true
 *   → { recipes: [{ parentItemCode, itemName, parentQty, components: [{familyKey,familyLabel,qty,mode}], costCount }] }
 * GET  /api/fabrication/recipes?parentItemCode=DECO16
 *   → { parentQty, components: [{familyKey,familyLabel,qty,mode}], costs: [{label,costPerColis}] }
 * PUT  /api/fabrication/recipes
 *   body { parentItemCode, parentQty, components, costs } → remplace toute la recette.
 * DELETE /api/fabrication/recipes?parentItemCode=DECO16
 *
 * Raw SQL : parentQty/qtyUnits ne sont pas connues du client Prisma généré.
 */

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

  const { searchParams } = new URL(req.url);

  if (searchParams.get("list") === "true") {
    type ListRow = {
      parentItemCode: string; itemName: string; parentQty: number;
      salesQtyPerPackUnit: number | null; salesUnit: string | null;
      components: { familyKey: string; familyLabel: string; qtyColis: number; qtyUnits: number | null }[] | null;
      costCount: number;
    };
    const recipes = await prisma.$queryRawUnsafe<ListRow[]>(`
      SELECT r."parentItemCode", p."itemName", r."parentQty",
             p."salesQtyPerPackUnit", p."salesUnit",
             (SELECT json_agg(json_build_object(
                       'familyKey', c."familyKey",
                       'familyLabel', c."familyLabel",
                       'qtyColis', c."qtyColis",
                       'qtyUnits', c."qtyUnits") ORDER BY c."position")
                FROM "ProductionRecipeComponent" c WHERE c."recipeId" = r."id") AS "components",
             (SELECT COUNT(*)::int FROM "ProductionRecipeCost" k WHERE k."recipeId" = r."id") AS "costCount"
        FROM "ProductionRecipe" r
        JOIN "Product" p ON p."itemCode" = r."parentItemCode"
       ORDER BY p."itemName" ASC;
    `);
    return NextResponse.json({
      ok: true,
      recipes: recipes.map((r) => ({
        parentItemCode: r.parentItemCode,
        itemName: r.itemName,
        salesQtyPerPackUnit: r.salesQtyPerPackUnit,
        salesUnit: r.salesUnit,
        costCount: r.costCount,
        parentQty: Number(r.parentQty) || 1,
        components: (r.components ?? []).map((c) => (c.qtyUnits != null
          ? { familyKey: c.familyKey, familyLabel: c.familyLabel, qty: Number(c.qtyUnits), mode: "unite" as const }
          : { familyKey: c.familyKey, familyLabel: c.familyLabel, qty: Number(c.qtyColis), mode: "colis" as const })),
      })),
    });
  }

  const parent = searchParams.get("parentItemCode")?.trim();
  if (!parent) {
    return NextResponse.json({ error: "parentItemCode ou list=true requis" }, { status: 400 });
  }
  const recipe = await getRecipe(parent);
  if (!recipe) {
    return NextResponse.json({ ok: true, parentItemCode: parent, parentQty: 1, components: [], costs: [] });
  }
  return NextResponse.json({ ok: true, ...recipe });
}

const PutSchema = z.object({
  parentItemCode: z.string().trim().min(1),
  /** Colis de parent produits par « tour » de recette (ex. 1 pour 1 DECO16). */
  parentQty: z.number().positive().max(999),
  components: z.array(z.object({
    familyKey: z.string().trim().min(1),
    familyLabel: z.string().trim().min(1),
    /** Quantité par tour, exprimée selon `mode`. */
    qty: z.number().positive(),
    /** "unite" = unités de base (barquette/kg — défaut v3) ; "colis" = legacy v2. */
    mode: z.enum(["unite", "colis"]).default("unite"),
  })).min(1),
  costs: z.array(z.object({
    label: z.string().trim().min(1).max(60),
    costPerColis: z.number().min(0),
  })),
});

export async function PUT(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

  const parsed = PutSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Données invalides", details: parsed.error.flatten() }, { status: 400 });
  }
  const { parentItemCode, parentQty, components, costs } = parsed.data;

  // Garde-fous : parent existant, pas deux fois la même famille.
  const parentRows = await prisma.$queryRawUnsafe<{ itemCode: string }[]>(
    `SELECT "itemCode" FROM "Product" WHERE "itemCode" = $1 LIMIT 1;`, parentItemCode,
  );
  if (parentRows.length === 0) {
    return NextResponse.json({ error: `Produit "${parentItemCode}" introuvable.` }, { status: 404 });
  }
  const keys = components.map((c) => c.familyKey);
  if (new Set(keys).size !== keys.length) {
    return NextResponse.json({ error: "Famille en double dans la recette" }, { status: 400 });
  }

  await prisma.$transaction(async (tx) => {
    const rows = await tx.$queryRawUnsafe<{ id: string }[]>(
      `INSERT INTO "ProductionRecipe" ("id", "parentItemCode", "parentQty", "createdAt", "updatedAt")
       VALUES (gen_random_uuid()::text, $1, $2, NOW(), NOW())
       ON CONFLICT ("parentItemCode") DO UPDATE SET "parentQty" = $2, "updatedAt" = NOW()
       RETURNING "id";`,
      parentItemCode, parentQty,
    );
    const recipeId = rows[0].id;

    await tx.$executeRawUnsafe(`DELETE FROM "ProductionRecipeComponent" WHERE "recipeId" = $1;`, recipeId);
    await tx.$executeRawUnsafe(`DELETE FROM "ProductionRecipeCost" WHERE "recipeId" = $1;`, recipeId);

    for (let i = 0; i < components.length; i++) {
      const c = components[i];
      // mode "unite" → qtyUnits fait foi (qtyColis posé à 0, colonne NOT NULL) ;
      // mode "colis" → régime v2 (qtyUnits NULL).
      await tx.$executeRawUnsafe(
        `INSERT INTO "ProductionRecipeComponent" ("id", "recipeId", "familyKey", "familyLabel", "qtyColis", "qtyUnits", "position")
         VALUES (gen_random_uuid()::text, $1, $2, $3, $4, $5, $6);`,
        recipeId, c.familyKey, c.familyLabel,
        c.mode === "colis" ? c.qty : 0,
        c.mode === "unite" ? c.qty : null,
        i,
      );
    }
    for (let i = 0; i < costs.length; i++) {
      const c = costs[i];
      await tx.$executeRawUnsafe(
        `INSERT INTO "ProductionRecipeCost" ("id", "recipeId", "label", "costPerColis", "position")
         VALUES (gen_random_uuid()::text, $1, $2, $3, $4);`,
        recipeId, c.label, c.costPerColis, i,
      );
    }
    await tx.$executeRawUnsafe(
      `UPDATE "Product" SET "isKit" = true WHERE "itemCode" = $1;`, parentItemCode,
    );
  });

  return NextResponse.json({
    ok: true, parentItemCode, parentQty,
    componentCount: components.length, costCount: costs.length,
  });
}

export async function DELETE(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const parent = searchParams.get("parentItemCode")?.trim();
  if (!parent) return NextResponse.json({ error: "parentItemCode requis" }, { status: 400 });

  await prisma.$transaction(async (tx) => {
    // Cascade : ProductionRecipeComponent/Cost ont ON DELETE CASCADE via Prisma.
    await tx.$executeRawUnsafe(`DELETE FROM "ProductionRecipe" WHERE "parentItemCode" = $1;`, parent);
    // isKit reste true si une BoM historique existe encore pour ce parent.
    await tx.$executeRawUnsafe(
      `UPDATE "Product" p SET "isKit" = EXISTS (SELECT 1 FROM "ProductBom" b WHERE b."parentItemCode" = p."itemCode")
        WHERE p."itemCode" = $1;`,
      parent,
    );
  });
  return NextResponse.json({ ok: true, parentItemCode: parent });
}
