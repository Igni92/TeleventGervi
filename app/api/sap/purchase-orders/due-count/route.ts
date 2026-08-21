import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

/**
 * GET /api/sap/purchase-orders/due-count
 *
 * Nombre de COMMANDES FOURNISSEURS ouvertes dont la date de livraison prévue
 * (DocDueDate) est atteinte (≤ aujourd'hui) → pastille « à réceptionner ».
 *
 * LU DEPUIS LE MIROIR (SapPurchaseOrder) : plus aucun appel SAP sur le chemin
 * critique de la sidebar (cf. PERF.md chantier A). Défensif : erreur → count 0.
 */
export async function GET() {
  const session = await auth();
  if (!session) return NextResponse.json({ count: 0 }, { status: 200 });

  try {
    const endOfToday = new Date();
    endOfToday.setHours(23, 59, 59, 999);
    const count = await prisma.sapPurchaseOrder.count({
      where: {
        documentStatus: "O",
        cancelled: false,
        docDueDate: { not: null, lte: endOfToday },
      },
    });
    return NextResponse.json({ count });
  } catch {
    return NextResponse.json({ count: 0 });
  }
}
