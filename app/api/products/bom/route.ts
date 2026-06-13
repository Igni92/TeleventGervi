import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

/**
 * Endpoint d'administration des nomenclatures (BoM) — recettes DECO etc.
 *
 * GET  /api/products/bom?parentItemCode=DECO12
 *   → { parent: {...}, components: [{ itemCode, itemName, qtyPerParent, purchasePrice }] }
 *
 * PUT  /api/products/bom
 *   body { parentItemCode, components: [{ componentItemCode, qtyPerParent }] }
 *   → remplace toute la BoM (upsert) + Product.isKit=true
 *
 * GET  /api/products/bom?list=true → liste des produits avec isKit=true.
 *
 * Note : utilise $queryRawUnsafe/$executeRawUnsafe en attendant que prisma generate
 * tourne sur le nouveau schema (ProductBom). Une fois la generate OK, on peut
 * passer aux helpers typés Prisma.
 */

interface BomRow {
  componentItemCode: string;
  qtyPerParent: number;
}

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const list = searchParams.get("list") === "true";
  const parent = searchParams.get("parentItemCode")?.trim();

  if (list) {
    // Tous les kits (isKit=true)
    const kits = await prisma.$queryRawUnsafe<{
      itemCode: string; itemName: string; salesUnit: string | null; salesQtyPerPackUnit: number | null;
    }[]>(
      `SELECT "itemCode","itemName","salesUnit","salesQtyPerPackUnit"
       FROM "Product" WHERE "isKit" = true ORDER BY "itemName" ASC`,
    );
    return NextResponse.json({ kits });
  }

  if (!parent) {
    return NextResponse.json({ error: "parentItemCode ou list=true requis" }, { status: 400 });
  }

  type Row = {
    componentItemCode: string; qtyPerParent: number;
    itemName: string; salesUnit: string | null; purchasePrice: number | null;
  };
  const components = await prisma.$queryRawUnsafe<Row[]>(
    `SELECT b."componentItemCode", b."qtyPerParent",
            p."itemName", p."salesUnit",
            (SELECT pb."purchasePrice" FROM "ProductBatch" pb
              WHERE pb."productId" = p."id" AND pb."purchasePrice" IS NOT NULL
              ORDER BY pb."admissionDate" DESC NULLS LAST LIMIT 1) AS "purchasePrice"
       FROM "ProductBom" b
       JOIN "Product" p ON p."itemCode" = b."componentItemCode"
      WHERE b."parentItemCode" = $1
      ORDER BY p."itemName" ASC`,
    parent,
  );

  return NextResponse.json({
    parentItemCode: parent,
    components: components.map((c) => ({
      itemCode: c.componentItemCode,
      itemName: c.itemName,
      salesUnit: c.salesUnit,
      qtyPerParent: c.qtyPerParent,
      purchasePrice: c.purchasePrice,
      // Coût ligne = qtyPerParent × purchasePrice (€/pie composant)
      lineCost: (c.purchasePrice ?? 0) * c.qtyPerParent,
    })),
  });
}

export async function PUT(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

  let body: { parentItemCode: string; components: BomRow[] };
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: "JSON invalide" }, { status: 400 }); }

  if (!body.parentItemCode?.trim()) {
    return NextResponse.json({ error: "parentItemCode requis" }, { status: 400 });
  }
  if (!Array.isArray(body.components)) {
    return NextResponse.json({ error: "components doit être un array" }, { status: 400 });
  }
  for (const c of body.components) {
    if (!c.componentItemCode?.trim() || !c.qtyPerParent || c.qtyPerParent <= 0) {
      return NextResponse.json({ error: `Composant invalide : ${JSON.stringify(c)}` }, { status: 400 });
    }
  }
  const parent = body.parentItemCode.trim();

  // Replace toute la BoM en transaction atomique.
  await prisma.$transaction([
    prisma.$executeRawUnsafe(`DELETE FROM "ProductBom" WHERE "parentItemCode" = $1`, parent),
    ...body.components.map((c) =>
      prisma.$executeRawUnsafe(
        `INSERT INTO "ProductBom" ("id","parentItemCode","componentItemCode","qtyPerParent","createdAt","updatedAt")
         VALUES (gen_random_uuid()::text, $1, $2, $3, NOW(), NOW())`,
        parent, c.componentItemCode.trim(), c.qtyPerParent,
      )
    ),
    prisma.$executeRawUnsafe(
      `UPDATE "Product" SET "isKit" = $1 WHERE "itemCode" = $2`,
      body.components.length > 0, parent,
    ),
  ]);

  return NextResponse.json({ ok: true, parentItemCode: parent, count: body.components.length });
}
