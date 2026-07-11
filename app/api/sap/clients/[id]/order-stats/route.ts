import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getAccessScope, clientInScope } from "@/lib/permissions";
import { getClientOrderStats, resolveClientCardCodes } from "@/lib/clientOrderStats";

/**
 * GET /api/sap/clients/[id]/order-stats
 *
 * Habitudes de commande du client pour les GARDE-FOUS de la console :
 *   - panierMoyen  : { moyenneHT, nbCommandes } (fenêtre ≤ 20 cdes / 365 j)
 *   - parArticle   : { [itemCode]: { moyenne, nbCommandes } } — quantités en
 *                    UNITÉ DE STOCK SAP (pièces/kg) ; la console convertit en
 *                    colis via le packDivisor de l'article.
 *
 * Source : miroir local SapOrder/SapOrderLine — rapide, tolère un miroir vide
 * (stats vides → les garde-fous « habitude » se désarment d'eux-mêmes).
 */
export async function GET(_req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  if (!(await clientInScope(await getAccessScope(session), params.id)))
    return NextResponse.json({ error: "Accès refusé à ce client." }, { status: 403 });

  const cardCodes = await resolveClientCardCodes(params.id);
  const stats = await getClientOrderStats(cardCodes);
  return NextResponse.json({ ok: true, ...stats });
}
