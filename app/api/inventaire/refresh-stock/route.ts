import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { refreshItemStocks } from "@/lib/stockSync";

export const dynamic = "force-dynamic";

/**
 * POST /api/inventaire/refresh-stock — import du stock SAP AVANT un comptage.
 *
 * Rafraîchit (depuis SAP) le stock des articles « en stock » pour que le
 * préparateur compte contre des quantités à jour. Accessible à tout compte
 * connecté (le préparateur déclenche au clic « Commencer »). Best-effort :
 * renvoie le nombre d'articles rafraîchis.
 */
export async function POST() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

  // On NE synchronise QUE les produits PHYSIQUEMENT en stock (inStock > 0 dans un
  // entrepôt inventorié) — pas tout le catalogue, ni les articles seulement « en
  // commande fournisseur » (pas encore reçus). C'est exactement le périmètre du
  // comptage. Tri d'abord, sync ensuite → rapide.
  const products = await prisma.product.findMany({
    where: {
      isPackaging: false,
      stocks: { some: { inStock: { gt: 0 } } },
    },
    select: { itemCode: true },
    take: 1000,
  });
  const codes = products.map((p) => p.itemCode);
  if (codes.length === 0) return NextResponse.json({ ok: true, refreshed: 0, total: 0 });

  try {
    const refreshed = await refreshItemStocks(codes);
    return NextResponse.json({ ok: true, refreshed, total: codes.length });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message, total: codes.length }, { status: 502 });
  }
}
