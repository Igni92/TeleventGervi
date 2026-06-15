import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getAccessScope, resolvePilotageView } from "@/lib/permissions";
import { clientsToRelance } from "@/lib/pilotage";
import { cached } from "@/lib/ttlCache";

/**
 * GET /api/pilotage/actions
 *
 * Liste actionnable pour le dashboard puzzle (écran 2) :
 *   - "À relancer" : clients planifiés (joursAppel set) sans facture SAP sur 30j,
 *      top 5 par ancienneté de la dernière commande.
 *
 * Pas de granularité : la relance est toujours sur fenêtre 30j (cf. arbitrage council).
 */
export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

  // Droits : « à relancer » scopé aux clients du commercial (ou « voir comme »).
  const scope = await getAccessScope(session);
  const { slp } = resolvePilotageView(scope, new URL(req.url).searchParams.get("as"));

  const toRelance = await cached(`pilotage:actions:${slp ?? "ALL"}`, 120_000, () => clientsToRelance(5, slp));
  return NextResponse.json({ toRelance });
}
