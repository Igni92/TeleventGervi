import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { sap } from "@/lib/sapb1";
import { isDepartureReached } from "@/lib/livraison";

/**
 * GET /api/bons-commande/due-count
 *
 * Nombre d'OFFRES CLIENT (Quotations SAP ouvertes, non annulées) dont le JOUR DE
 * DÉPART est atteint — c.-à-d. dont la date de livraison est entrée dans la
 * fenêtre normalement livrable (ce n'est plus une précommande). Alimente la
 * pastille « à passer en commande » sur l'onglet Bons de commande.
 *
 * Léger : on ne ramène que DocDueDate (filtre ouvert/non-annulé côté SAP) et on
 * compte côté serveur via isDepartureReached (jours ouvrés/fériés → pas un
 * simple filtre OData). Défensif : SAP indisponible → count 0 (jamais d'erreur).
 */
export async function GET() {
  const session = await auth();
  if (!session) return NextResponse.json({ count: 0 }, { status: 200 });

  try {
    const filter = "DocumentStatus eq 'bost_Open' and Cancelled eq 'tNO'";
    const res = await sap.get<{ value: { DocDueDate?: string }[] }>(
      `Quotations?$select=DocDueDate&$top=200&$filter=${encodeURIComponent(filter)}`,
    );
    const count = (res.value ?? []).filter((q) => q.DocDueDate && isDepartureReached(q.DocDueDate)).length;
    return NextResponse.json({ count });
  } catch {
    return NextResponse.json({ count: 0 });
  }
}
