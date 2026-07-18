import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { requireAdmin } from "@/lib/permissions";
import { listCarrierTariffs, setCarrierTariff, getCarrierTariff } from "@/lib/transportCostStore";
import { sanitizeCarrierTariff } from "@/lib/carrierTariff";

export const dynamic = "force-dynamic";

/**
 * GRILLES TARIFAIRES des transporteurs externes — coût PAR POSITION (tranches
 * de poids modifiables × zones de départements + lignes fixes € et en %).
 *
 * GET /api/transport/tarifs → { ok, tariffs: { <U_TrspCode>: CarrierTariff } }
 *   Lecture ouverte à tout utilisateur connecté (console & fiche client en ont
 *   besoin pour estimer le coût transport d'une commande).
 * PUT /api/transport/tarifs { tariff: CarrierTariff }
 *   Écriture réservée à la direction / aux admins. Une grille sans zone ni
 *   ligne annexe est SUPPRIMÉE (retour au repli legacy €/kg du client).
 */
export async function GET() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  const tariffs = await listCarrierTariffs();
  return NextResponse.json({ ok: true, tariffs });
}

export async function PUT(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  if (!(await requireAdmin(session))) {
    return NextResponse.json({ error: "Réservé à la direction / aux administrateurs" }, { status: 403 });
  }

  let body: { tariff?: unknown };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "JSON invalide" }, { status: 400 }); }

  const tariff = sanitizeCarrierTariff(body.tariff);
  if (!tariff.carrierCode) {
    return NextResponse.json({ error: "Code transporteur manquant" }, { status: 400 });
  }
  tariff.updatedAt = new Date().toISOString();
  tariff.updatedBy = session.user.email ?? session.user.name ?? null;

  try {
    await setCarrierTariff(tariff);
    const saved = await getCarrierTariff(tariff.carrierCode);
    return NextResponse.json({ ok: true, tariff: saved });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
