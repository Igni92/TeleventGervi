import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { isDepartureReached } from "@/lib/livraison";

/**
 * GET /api/bons-commande/due-count
 *
 * Nombre d'OFFRES CLIENT (Quotations ouvertes, non annulées) dont le JOUR DE
 * DÉPART est atteint — alimente la pastille « à passer en commande ».
 *
 * LU DEPUIS LE MIROIR (SapQuotation) : plus aucun appel SAP sur le chemin
 * critique de la sidebar. Le cron `mirror` maintient le statut O/C et la date
 * d'échéance (cf. PERF.md chantier A). Le comptage `isDepartureReached`
 * (jours ouvrés/fériés) reste côté serveur. Défensif : erreur → count 0.
 */
export async function GET() {
  const session = await auth();
  if (!session) return NextResponse.json({ count: 0 }, { status: 200 });

  try {
    const rows = await prisma.sapQuotation.findMany({
      where: { documentStatus: "O", cancelled: false, docDueDate: { not: null } },
      select: { docDueDate: true },
    });
    const count = rows.filter(
      (q) => q.docDueDate && isDepartureReached(q.docDueDate.toISOString()),
    ).length;
    return NextResponse.json({ count });
  } catch {
    return NextResponse.json({ count: 0 });
  }
}
