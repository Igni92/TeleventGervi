import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { requireAdmin } from "@/lib/permissions";
import { getTransportModel, setTransportModel } from "@/lib/transportCostStore";
import { computeTransportMetrics, sanitizeTransportModel } from "@/lib/transportCost";

export const dynamic = "force-dynamic";

/**
 * Modèle de COÛT DE TRANSPORT (structure de coûts saisie par la direction) +
 * métriques dérivées (prix position €/kg, coût/livraison…).
 *
 * GET  /api/transport/model → { ok, model, metrics }
 *   Lecture ouverte à tout utilisateur connecté (la fiche client, la console et
 *   le pilotage ont besoin du prix position pour la marge nette transport).
 * PUT  /api/transport/model { costs, deliveriesPerYear, kgPerYear }
 *   Écriture réservée à la direction / aux admins (requireAdmin).
 */
export async function GET() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  const model = await getTransportModel();
  return NextResponse.json({ ok: true, model, metrics: computeTransportMetrics(model) });
}

export async function PUT(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  if (!(await requireAdmin(session))) {
    return NextResponse.json({ error: "Réservé à la direction / aux administrateurs" }, { status: 403 });
  }

  let body: unknown;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "JSON invalide" }, { status: 400 }); }

  const model = sanitizeTransportModel(body);
  model.updatedAt = new Date().toISOString();
  model.updatedBy = session.user.email ?? session.user.name ?? null;

  try {
    await setTransportModel(model);
    return NextResponse.json({ ok: true, model, metrics: computeTransportMetrics(model) });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
