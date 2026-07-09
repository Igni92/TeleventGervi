import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

/**
 * GET /api/products/[id]/batches[?inStock=1]
 * Lots d'un produit (table locale ProductBatch — rapide, aucun appel SAP).
 *   • inStock=1 → lots ENCORE VALABLES : DLC non dépassée (ou absente).
 *     ⚠️ On ne filtre PLUS sur `quantity` : cette colonne n'est jamais alimentée
 *     par la synchro (défaut 0) — le filtre `quantity > 0` masquait donc À TORT
 *     *tous* les lots (« aucun lot » alors que l'article est en stock). Le stock
 *     par lot n'existe pas dans le Service Layer de cette base ; la DLC est le
 *     signal fiable « encore en stock » pour du frais.
 *   • tri FEFO : DLC la plus proche d'abord (null en dernier), puis admission.
 * La quantité en stock est affichée en tête du détail à partir du dispo déjà connu
 * côté console (en colis) — inutile de le recalculer ici.
 */
export async function GET(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

  const inStock = new URL(req.url).searchParams.get("inStock") === "1";
  // Début de journée : une DLC = aujourd'hui reste « en stock » (pas encore dépassée).
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const batches = await prisma.productBatch.findMany({
    where: {
      productId: params.id,
      ...(inStock ? { OR: [{ expirationDate: null }, { expirationDate: { gte: today } }] } : {}),
    },
    orderBy: [
      { expirationDate: { sort: "asc", nulls: "last" } },
      { admissionDate: "desc" },
      { batchNumber: "asc" },
    ],
    take: 50,
  });

  return NextResponse.json({ batches });
}
