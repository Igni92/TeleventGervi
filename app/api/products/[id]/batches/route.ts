import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getLotNotes } from "@/lib/marchandiseNote";

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
 * Renvoie aussi `physicalStock` (somme ProductStock.inStock, unité SAP) : c'est le
 * comparable des quantités par lot du registre — le « dispo » connu côté console
 * est NET des commandes engagées (available), donc plus bas que la somme des lots.
 */
export async function GET(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

  const inStock = new URL(req.url).searchParams.get("inStock") === "1";
  // Début de journée : une DLC = aujourd'hui reste « en stock » (pas encore dépassée).
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const [batches, product, phys] = await Promise.all([
    prisma.productBatch.findMany({
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
    }),
    prisma.product.findUnique({ where: { id: params.id }, select: { itemCode: true } }),
    prisma.productStock.aggregate({ where: { productId: params.id }, _sum: { inStock: true } }),
  ]);

  // Note qualité (étoiles) par lot, saisie à la réception (clé par itemCode+lot).
  const lotNotes = product
    ? await getLotNotes(product.itemCode, batches.map((b) => b.batchNumber))
    : new Map<string, number>();
  const withNotes = batches.map((b) => ({ ...b, rating: lotNotes.get(b.batchNumber) ?? null }));

  return NextResponse.json({ batches: withNotes, physicalStock: phys._sum.inStock ?? null });
}
