import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

/**
 * Recettes d'ordre de production (familles + lignes de coût, tout en colis).
 *
 * GET  /api/production/recipes?parentItemCode=DECO12
 *   → { parent, components:[{familyKey,familyLabel,qtyColis}], costs:[{label,costPerColis}] }
 * GET  /api/production/recipes?list=true
 *   → { recipes: [{ parentItemCode, itemName, componentCount }] }
 * PUT  /api/production/recipes
 *   body { parentItemCode, components:[{familyKey,familyLabel,qtyColis}], costs:[{label,costPerColis}] }
 *   → remplace toute la recette (transaction).
 *
 * Raw SQL : le client Prisma n'est pas régénéré (dev server tient le DLL).
 */

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  if (searchParams.get("list") === "true") {
    const recipes = await prisma.$queryRaw<
      { parentItemCode: string; itemName: string; componentCount: number }[]
    >(Prisma.sql`
      SELECT r."parentItemCode", p."itemName",
             COUNT(c."id")::int AS "componentCount"
      FROM "ProductionRecipe" r
      JOIN "Product" p ON p."itemCode" = r."parentItemCode"
      LEFT JOIN "ProductionRecipeComponent" c ON c."recipeId" = r."id"
      GROUP BY r."parentItemCode", p."itemName"
      ORDER BY p."itemName" ASC;
    `);
    return NextResponse.json({ ok: true, recipes });
  }

  const parent = searchParams.get("parentItemCode")?.trim();
  if (!parent) {
    return NextResponse.json({ error: "parentItemCode ou list=true requis" }, { status: 400 });
  }

  const recipe = await prisma.$queryRaw<{ id: string }[]>(Prisma.sql`
    SELECT "id" FROM "ProductionRecipe" WHERE "parentItemCode" = ${parent} LIMIT 1;
  `);
  if (recipe.length === 0) {
    return NextResponse.json({ ok: true, parentItemCode: parent, components: [], costs: [] });
  }
  const recipeId = recipe[0].id;

  const [components, costs] = await Promise.all([
    prisma.$queryRaw<{ familyKey: string; familyLabel: string; qtyColis: number }[]>(Prisma.sql`
      SELECT "familyKey", "familyLabel", "qtyColis"
      FROM "ProductionRecipeComponent" WHERE "recipeId" = ${recipeId}
      ORDER BY "position" ASC, "familyLabel" ASC;
    `),
    prisma.$queryRaw<{ label: string; costPerColis: number }[]>(Prisma.sql`
      SELECT "label", "costPerColis"
      FROM "ProductionRecipeCost" WHERE "recipeId" = ${recipeId}
      ORDER BY "position" ASC;
    `),
  ]);

  return NextResponse.json({
    ok: true,
    parentItemCode: parent,
    components: components.map((c) => ({ ...c, qtyColis: Number(c.qtyColis) })),
    costs: costs.map((c) => ({ ...c, costPerColis: Number(c.costPerColis) })),
  });
}

const PutSchema = z.object({
  parentItemCode: z.string().trim().min(1),
  components: z.array(z.object({
    familyKey: z.string().trim().min(1),
    familyLabel: z.string().trim().min(1),
    qtyColis: z.number().positive(),
  })),
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
  const { parentItemCode, components, costs } = parsed.data;

  // Garde-fou : pas deux fois la même famille.
  const keys = components.map((c) => c.familyKey);
  if (new Set(keys).size !== keys.length) {
    return NextResponse.json({ error: "Famille en double dans la recette" }, { status: 400 });
  }

  await prisma.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<{ id: string }[]>(Prisma.sql`
      INSERT INTO "ProductionRecipe" ("id", "parentItemCode", "createdAt", "updatedAt")
      VALUES (gen_random_uuid()::text, ${parentItemCode}, NOW(), NOW())
      ON CONFLICT ("parentItemCode") DO UPDATE SET "updatedAt" = NOW()
      RETURNING "id";
    `);
    const recipeId = rows[0].id;

    await tx.$executeRaw`DELETE FROM "ProductionRecipeComponent" WHERE "recipeId" = ${recipeId};`;
    await tx.$executeRaw`DELETE FROM "ProductionRecipeCost" WHERE "recipeId" = ${recipeId};`;

    for (let i = 0; i < components.length; i++) {
      const c = components[i];
      await tx.$executeRaw`
        INSERT INTO "ProductionRecipeComponent" ("id", "recipeId", "familyKey", "familyLabel", "qtyColis", "position")
        VALUES (gen_random_uuid()::text, ${recipeId}, ${c.familyKey}, ${c.familyLabel}, ${c.qtyColis}, ${i});
      `;
    }
    for (let i = 0; i < costs.length; i++) {
      const c = costs[i];
      await tx.$executeRaw`
        INSERT INTO "ProductionRecipeCost" ("id", "recipeId", "label", "costPerColis", "position")
        VALUES (gen_random_uuid()::text, ${recipeId}, ${c.label}, ${c.costPerColis}, ${i});
      `;
    }

    await tx.$executeRaw`UPDATE "Product" SET "isKit" = ${components.length > 0} WHERE "itemCode" = ${parentItemCode};`;
  });

  return NextResponse.json({ ok: true, parentItemCode, componentCount: components.length, costCount: costs.length });
}
