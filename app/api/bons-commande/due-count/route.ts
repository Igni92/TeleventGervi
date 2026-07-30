import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { sap } from "@/lib/sapb1";
import { isDepartureReached } from "@/lib/livraison";
import { cached } from "@/lib/ttlCache";

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
    // Pastille de la sidebar : présente sur TOUTES les pages, rafraîchie toutes
    // les 120 s par chaque onglet ouvert. Sans cache, chaque chargement d'écran
    // — y compris les plus lents — payait cet appel SAP sur son chemin critique.
    // Le compte est GLOBAL (aucune donnée de session) → une seule clé suffit.
    // TTL aligné sur l'intervalle client : aucune perte de fraîcheur perçue.
    const count = await cached("sidebar:offres-due", 120_000, async () => {
      const filter = "DocumentStatus eq 'bost_Open' and Cancelled eq 'tNO'";
      const res = await sap.get<{ value: { DocDueDate?: string }[] }>(
        `Quotations?$select=DocDueDate&$top=200&$filter=${encodeURIComponent(filter)}`,
        // ⚠️ Sans le header Prefer, ce Service Layer plafonne la page à 20 documents
        // quel que soit le $top : la pastille SOUS-COMPTAIT dès la 21ᵉ offre.
        { headers: { Prefer: "odata.maxpagesize=200" } },
      );
      return (res.value ?? []).filter((q) => q.DocDueDate && isDepartureReached(q.DocDueDate)).length;
    });
    return NextResponse.json({ count });
  } catch {
    return NextResponse.json({ count: 0 });
  }
}
