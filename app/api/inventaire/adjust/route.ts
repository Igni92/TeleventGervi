import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { requireAdmin } from "@/lib/permissions";
import { getSession, saveSession } from "@/lib/inventory";
import { computeAdjustmentPlan, summarizeMoves, executeAdjustment } from "@/lib/inventoryAdjust";
import { sap } from "@/lib/sapb1";

export const dynamic = "force-dynamic";

function actorOf(session: { user?: { email?: string | null; name?: string | null } }): string {
  return session.user?.email ?? session.user?.name ?? "?";
}

/**
 * GET /api/inventaire/adjust?id=<id>  — APERÇU (aucune écriture SAP).
 * Renvoie les mouvements qui seraient postés (sorties/entrées, lots EM, valeurs)
 * pour que l'admin confirme avant l'écriture. Réservé admin/direction.
 */
export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  if (!(await requireAdmin(session))) {
    return NextResponse.json({ error: "Réservé à l'administration / direction" }, { status: 403 });
  }
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id requis" }, { status: 400 });
  const s = await getSession(id);
  if (!s) return NextResponse.json({ error: "Session introuvable" }, { status: 404 });

  const moves = await computeAdjustmentPlan(s);
  return NextResponse.json({
    ok: true,
    sapEnv: sap.getEnvironment().env,
    sapCompany: sap.getEnvironment().company,
    alreadyAdjusted: !!s.adjustment,
    adjustment: s.adjustment ?? null,
    moves,
    ...summarizeMoves(moves),
  });
}

/**
 * POST /api/inventaire/adjust  body { id }  — EXÉCUTE la régularisation.
 * Poste les sorties/entrées dans la base SAP active, met à jour le miroir, marque
 * la session « adjusted » et stocke la trace. Idempotent : refuse si déjà ajustée.
 * Réservé admin/direction.
 */
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  if (!(await requireAdmin(session))) {
    return NextResponse.json({ error: "Réservé à l'administration / direction" }, { status: 403 });
  }
  const body = await req.json().catch(() => null);
  const id = body?.id as string | undefined;
  if (!id) return NextResponse.json({ error: "id requis" }, { status: 400 });

  const s = await getSession(id);
  if (!s) return NextResponse.json({ error: "Session introuvable" }, { status: 404 });

  // Garde anti-double-écriture : une session déjà régularisée (même en erreur) ne
  // se rejoue pas automatiquement — sinon on risque un double mouvement de stock.
  if (s.adjustment) {
    return NextResponse.json(
      { error: s.adjustment.status === "error"
          ? "Régularisation déjà tentée et en erreur — à reprendre manuellement dans SAP."
          : "Inventaire déjà régularisé." , adjustment: s.adjustment },
      { status: 409 },
    );
  }

  const actor = actorOf(session);
  const adjustment = await executeAdjustment(s, actor);

  // Persiste la trace + bascule l'état. Même en erreur partielle on enregistre
  // (statut adjusted) pour éviter un re-post : l'admin reconcilie dans SAP.
  s.adjustment = adjustment;
  s.status = "adjusted";
  if (!s.reviewedAt) { s.reviewedAt = adjustment.at; s.reviewedBy = actor; }
  await saveSession(s);

  const httpStatus = adjustment.status === "error" ? 502 : 200;
  return NextResponse.json({ ok: adjustment.status !== "error", adjustment }, { status: httpStatus });
}
