import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

/**
 * GET /api/products/groups
 * Returns all distinct product groups (id, name, product count) sorted by name.
 * Used to populate the group filter dropdown on /products.
 */
export async function GET() {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

  // Only groups that have at least one product currently in stock (dispo > 0).
  // Using groupBy with where filter that includes the stocks relation.
  const raw = await prisma.product.groupBy({
    by: ["itemGroup", "groupName"],
    where: {
      isPackaging: false,
      itemGroup: { not: null },
      stocks: { some: { available: { gt: 0 } } },
    },
    _count: { id: true },
    orderBy: { groupName: "asc" },
  });

  const groups = raw
    .filter((g) => g.groupName && !/^\.+$/.test(g.groupName))
    .map((g) => ({
      id: g.itemGroup,
      name: g.groupName,
      count: g._count.id,
    }));

  return NextResponse.json({ groups });
}
