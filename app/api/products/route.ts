import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

/**
 * GET /api/products
 *
 * Query params:
 *   search        : ItemCode/ItemName contains (case-insensitive)
 *   group         : ItemsGroupCode (number)
 *   inStock       : "true" → only products with total stock > 0
 *   includePack   : "true" → include packaging-tagged items (default: false, hidden)
 *   page          : default 1
 *   limit         : default 50, max 200
 */
export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const search = searchParams.get("search")?.trim() || "";
  const group = searchParams.get("group");
  const groupsParam = searchParams.get("groups"); // comma-separated list
  const inStockOnly = searchParams.get("inStock") === "true";
  const includePackaging = searchParams.get("includePack") === "true";
  const page = Math.max(1, parseInt(searchParams.get("page") || "1"));
  const limit = Math.min(200, Math.max(1, parseInt(searchParams.get("limit") || "50")));

  const where: Record<string, unknown> = {};
  if (!includePackaging) where.isPackaging = false;
  // "En stock" signifie "dispo > 0" (= inStock - committed), pas juste inStock > 0.
  if (inStockOnly) {
    where.stocks = { some: { available: { gt: 0 } } };
  }
  // Single group (legacy) OR multi-group (?groups=1,2,3)
  if (groupsParam) {
    const ids = groupsParam.split(",").map((s) => parseInt(s)).filter((n) => !isNaN(n));
    if (ids.length === 1) where.itemGroup = ids[0];
    else if (ids.length > 1) where.itemGroup = { in: ids };
  } else if (group) {
    where.itemGroup = parseInt(group);
  }
  if (search) {
    where.OR = [
      { itemCode: { contains: search, mode: "insensitive" } },
      { itemName: { contains: search, mode: "insensitive" } },
    ];
  }

  const [items, total] = await Promise.all([
    prisma.product.findMany({
      where,
      include: { stocks: true },
      orderBy: [{ totalStock: "desc" }, { itemName: "asc" }],
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.product.count({ where }),
  ]);

  // Reshape: each product gets a `stockByWarehouse` map for easier UI use.
  // Cast temporary pour les U_* fields tant que Prisma generate est bloqué.
  const products = items.map((rawP) => {
    const p = rawP as typeof rawP & {
      uPays: string | null; uMarque: string | null; uCondi: string | null;
      uUvc: string | null; uNbBarqColis: number | null;
    };
    const stockByWarehouse: Record<string, {
      inStock: number; committed: number; ordered: number; available: number;
    }> = {};
    for (const s of p.stocks) {
      stockByWarehouse[s.warehouse] = {
        inStock: s.inStock,
        committed: s.committed,
        ordered: s.ordered,
        available: s.available,
      };
    }
    return {
      id: p.id,
      itemCode: p.itemCode,
      itemName: p.itemName,
      itemGroup: p.itemGroup,
      groupName: p.groupName,
      salesUnit: p.salesUnit,
      salesPackagingUnit: p.salesPackagingUnit,
      salesQtyPerPackUnit: p.salesQtyPerPackUnit,
      salesUnitWeight: p.salesUnitWeight,
      inventoryUnit: p.inventoryUnit,
      purchaseUnit: p.purchaseUnit,
      manageBatch: p.manageBatch,
      isPackaging: p.isPackaging,
      totalStock: p.totalStock,
      syncedAt: p.syncedAt,
      // Champs custom Gervifrais
      uPays: p.uPays,
      uMarque: p.uMarque,
      uCondi: p.uCondi,
      uUvc: p.uUvc,
      uNbBarqColis: p.uNbBarqColis,
      stockByWarehouse,
    };
  });

  return NextResponse.json({
    products,
    total,
    page,
    limit,
    totalPages: Math.ceil(total / limit),
  });
}
