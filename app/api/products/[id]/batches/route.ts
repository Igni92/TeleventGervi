import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

/**
 * GET /api/products/[id]/batches
 * Returns all batches (lots) for a given product, sorted by admission date desc.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } },
) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

  const batches = await prisma.productBatch.findMany({
    where: { productId: params.id },
    orderBy: [{ admissionDate: "desc" }, { batchNumber: "asc" }],
  });

  return NextResponse.json({ batches });
}
