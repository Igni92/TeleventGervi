import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getAccessScope, clientInScope } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { getClientCarriers } from "@/lib/clientCarriers";
import { getClientTournee } from "@/lib/clientTournee";

/**
 * GET /api/clients/[id]/carriers
 *
 * Transporteurs POSSIBLES pour un client = transporteurs réellement utilisés
 * dans son historique SAP (ORDR.U_TrspCode, 24 mois), mappés sur la table
 * Carrier locale (création à la volée si un code historique manque, ex. ECOLISE).
 *
 * CONTRAT (consommé par le front — ne pas dévier) :
 *   { carriers: [{ id, name, sapValue, count }], defaultId: string | null }
 *   - triés par count desc ; defaultId = le plus utilisé
 *   - client sans historique → carriers: [] + defaultId: null
 *     (le front retombe alors sur la liste complète /api/carriers)
 *   - ADDITIF : `savedTournee` = tournée MÉMORISÉE du client (lib/clientTournee,
 *     alimentée par « Détail livraison » et la création de bon) — sert à
 *     pré-sélectionner la tournée par défaut à la création (useTourneeSelection).
 *
 * Query optionnelle `?cardCode=` : résout pour CE CardCode plutôt que le code
 * client de base — un compte de livraison alternatif (ex. « LPOI. » / SCACHAP)
 * a sa PROPRE affectation SERG_TRCL / historique / tournée mémorisée, un magasin
 * à part entière, à ne PAS faire hériter du compte direct du même client.
 * Ignoré (repli code client) si le CardCode fourni n'appartient pas à ce client.
 *
 * Cache : lib/clientCarriers.ts garde un cache module-level 10 min par CardCode.
 */
export async function GET(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  if (!(await clientInScope(await getAccessScope(session), params.id)))
    return NextResponse.json({ error: "Accès refusé à ce client." }, { status: 403 });

  const client = await prisma.client.findUnique({
    where: { id: params.id },
    select: { id: true, code: true },
  });
  if (!client) return NextResponse.json({ error: "Client introuvable" }, { status: 404 });
  if (!client.code) return NextResponse.json({ carriers: [], defaultId: null });

  // CardCode à résoudre : celui du compte de livraison demandé (doit appartenir
  // à CE client), sinon le code client de base.
  let cardCode = client.code;
  const requested = req.nextUrl.searchParams.get("cardCode")?.trim();
  if (requested && requested.toUpperCase() !== client.code.trim().toUpperCase()) {
    const owns = await prisma.$queryRawUnsafe<{ n: number }[]>(
      `SELECT COUNT(*)::int AS n FROM "ClientDeliveryMode" WHERE "clientId" = $1 AND "sapCardCode" = $2`,
      client.id, requested,
    );
    if (owns[0]?.n) cardCode = requested;
  }

  // Tournée mémorisée (additif, best-effort) — pré-sélection du défaut au front.
  const savedTournee = await getClientTournee(cardCode).catch(() => null);

  try {
    const result = await getClientCarriers(cardCode);
    return NextResponse.json({ ...result, savedTournee });
  } catch (e) {
    // Résilience : SAP indisponible → contrat respecté avec liste vide, le front
    // retombe sur la liste complète. On log côté serveur pour diagnostic.
    console.warn(`[clients/${params.id}/carriers] Historique SAP indisponible:`, (e as Error).message);
    return NextResponse.json({ carriers: [], defaultId: null, savedTournee });
  }
}
