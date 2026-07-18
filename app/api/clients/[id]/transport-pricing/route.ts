import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getAccessScope, clientInScope, requireAdmin } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { getClientTransportPricing, setClientTransportPricing, listCarrierTariffs } from "@/lib/transportCostStore";
import { sanitizeClientPricing } from "@/lib/transportCost";
import { departementOfZip } from "@/lib/geo/zip";

export const dynamic = "force-dynamic";

/**
 * Tarif transport d'un CLIENT par transporteur (transporteurs non directs).
 *
 * GET /api/clients/[id]/transport-pricing
 *   → { ok, pricing: { <U_TrspCode>: €/kg }  — LEGACY (repli),
 *        departement: string | null          — déduit du CP SAP du client,
 *        tariffs: { <U_TrspCode>: CarrierTariff } — grilles PAR POSITION }
 * PUT /api/clients/[id]/transport-pricing { pricing: { <U_TrspCode>: €/kg } }
 *
 * Le coût d'une livraison externe se lit dans la GRILLE du transporteur
 * (tranches de poids × département — cf. lib/carrierTariff) ; le €/kg par
 * client ne sert plus que de repli tant qu'aucune grille n'est saisie.
 * Lecture : tout utilisateur dans le périmètre du client (console). Écriture :
 * direction / admin. Persistance AppSetting, aucune migration.
 */
export async function GET(_req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  if (!(await clientInScope(await getAccessScope(session), params.id))) {
    return NextResponse.json({ error: "Accès refusé à ce client." }, { status: 403 });
  }
  const [pricing, tariffs, client] = await Promise.all([
    getClientTransportPricing(params.id),
    listCarrierTariffs(),
    prisma.client.findUnique({ where: { id: params.id }, select: { zipCode: true } }).catch(() => null),
  ]);
  const departement = departementOfZip(client?.zipCode);
  return NextResponse.json({ ok: true, pricing, departement, tariffs });
}

export async function PUT(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  if (!(await requireAdmin(session))) {
    return NextResponse.json({ error: "Réservé à la direction / aux administrateurs" }, { status: 403 });
  }

  let body: { pricing?: unknown };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "JSON invalide" }, { status: 400 }); }

  const pricing = sanitizeClientPricing(body.pricing);
  try {
    await setClientTransportPricing(params.id, pricing);
    return NextResponse.json({ ok: true, pricing });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
