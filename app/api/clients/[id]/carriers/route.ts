import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getAccessScope, clientInScope } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { getClientCarriers } from "@/lib/clientCarriers";

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
 *
 * Cache : lib/clientCarriers.ts garde un cache module-level 10 min par CardCode.
 */
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
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

  try {
    const result = await getClientCarriers(client.code);
    return NextResponse.json(result);
  } catch (e) {
    // Résilience : SAP indisponible → contrat respecté avec liste vide, le front
    // retombe sur la liste complète. On log côté serveur pour diagnostic.
    console.warn(`[clients/${params.id}/carriers] Historique SAP indisponible:`, (e as Error).message);
    return NextResponse.json({ carriers: [], defaultId: null });
  }
}
