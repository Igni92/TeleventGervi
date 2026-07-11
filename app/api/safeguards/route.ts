import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { requireAdmin } from "@/lib/permissions";
import { getSafeguardsConfig, saveSafeguardsConfig } from "@/lib/safeguardsStore";

/**
 * GET /api/safeguards
 *   Config des garde-fous de vente (lecture : tout utilisateur connecté — la
 *   console en a besoin pour afficher les alertes en direct).
 *
 * PUT /api/safeguards   { config: SafeguardsConfig }
 *   Écrit la config (admin/direction uniquement). Le payload est NORMALISÉ
 *   côté serveur (modes/seuils invalides ramenés aux défauts ou clampés) et
 *   la version stockée est renvoyée — l'UI se resynchronise dessus.
 */

export async function GET() {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  const config = await getSafeguardsConfig();
  return NextResponse.json({ ok: true, config });
}

export async function PUT(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  if (!(await requireAdmin(session))) {
    return NextResponse.json({ error: "Réservé aux administrateurs." }, { status: 403 });
  }
  let body: { config?: unknown };
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: "JSON invalide" }, { status: 400 }); }
  try {
    const config = await saveSafeguardsConfig(body?.config ?? null);
    return NextResponse.json({ ok: true, config });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
