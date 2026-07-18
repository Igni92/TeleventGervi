import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getLotNotes } from "@/lib/marchandiseNote";
import { planLedgerTrim } from "@/lib/gervifrais-calc";

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
 * Chaque lot porte `sellable` = quantité RESTANT À VENDRE : le DISPO de l'article
 * (somme ProductStock.available = physique − commandes engagées) réparti sur les
 * lots du registre, les PLUS RÉCENTS servis d'abord (FIFO : on vend les plus
 * anciens en premier — ce qui reste à vendre vit dans les derniers arrivages).
 * Un lot entièrement vendu/engagé a `sellable` 0 et disparaît du détail console.
 * Le `quantity` du registre reste la présence PHYSIQUE (les commandes engagées
 * pas encore parties ont toujours besoin de leur lot pour l'affectation).
 * Renvoie aussi `physicalStock` (somme inStock) et `availableStock` (somme
 * available), unité SAP.
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
    prisma.productStock.aggregate({ where: { productId: params.id }, _sum: { inStock: true, available: true } }),
  ]);

  // RESTANT À VENDRE par lot : le dispo (physique − engagé) réparti sur les lots
  // du registre, plus récents d'abord — planLedgerTrim écrête les plus anciens
  // (déjà vendus/engagés). Dispo inconnu (aucun stock miroir) → registre tel quel.
  const available = phys._sum.available;
  const sellableById = new Map<string, number>();
  if (available != null) {
    for (const t of planLedgerTrim(batches.filter((b) => b.quantity > 0), available)) {
      sellableById.set(t.lot.id, t.quantity);
    }
  }
  const sellableOf = (b: { id: string; quantity: number }): number => {
    if (b.quantity <= 0) return 0;
    if (available == null) return b.quantity;
    return sellableById.get(b.id) ?? b.quantity;
  };

  // Note qualité (étoiles) par lot, saisie à la réception (clé par itemCode+lot).
  const lotNotes = product
    ? await getLotNotes(product.itemCode, batches.map((b) => b.batchNumber))
    : new Map<string, number>();
  const withNotes = batches.map((b) => ({
    ...b,
    rating: lotNotes.get(b.batchNumber) ?? null,
    sellable: sellableOf(b),
  }));

  return NextResponse.json({
    batches: withNotes,
    physicalStock: phys._sum.inStock ?? null,
    availableStock: available ?? null,
  });
}
