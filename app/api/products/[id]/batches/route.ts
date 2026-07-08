import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

/**
 * GET /api/products/[id]/batches[?inStock=1]
 * Lots d'un produit (table locale ProductBatch — rapide, aucun appel SAP).
 *   • inStock=1 → seulement les lots ENCORE EN STOCK (quantity > 0) ;
 *   • tri FEFO : DLC la plus proche d'abord (null en dernier), puis admission.
 */
export async function GET(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

  const inStock = new URL(req.url).searchParams.get("inStock") === "1";

  const batches = await prisma.productBatch.findMany({
    where: { productId: params.id, ...(inStock ? { quantity: { gt: 0 } } : {}) },
    orderBy: [
      { expirationDate: { sort: "asc", nulls: "last" } },
      { admissionDate: "desc" },
      { batchNumber: "asc" },
    ],
  });

  return NextResponse.json({ batches });
}
