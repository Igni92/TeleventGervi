import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getAccessScope, clientInScope, requireAdmin } from "@/lib/permissions";
import { getClientTransportPricing, setClientTransportPricing } from "@/lib/transportCostStore";
import { sanitizeClientPricing } from "@/lib/transportCost";

export const dynamic = "force-dynamic";

/**
 * Tarif transport d'un CLIENT par transporteur (transporteurs non directs).
 *
 * GET /api/clients/[id]/transport-pricing → { ok, pricing: { <U_TrspCode>: €/kg } }
 * PUT /api/clients/[id]/transport-pricing { pricing: { <U_TrspCode>: €/kg } }
 *
 * Un client peut avoir plusieurs transporteurs possibles, chacun avec son
 * propre prix au kilo. Lecture : tout utilisateur dans le périmètre du client
 * (la console en a besoin). Écriture : direction / admin. Persistance AppSetting
 * (`transportcli:<id>`), aucune migration.
 */
export async function GET(_req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  if (!(await clientInScope(await getAccessScope(session), params.id))) {
    return NextResponse.json({ error: "Accès refusé à ce client." }, { status: 403 });
  }
  const pricing = await getClientTransportPricing(params.id);
  return NextResponse.json({ ok: true, pricing });
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
