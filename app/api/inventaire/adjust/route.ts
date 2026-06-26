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

/** Vrai si RIEN n'a été posté dans SAP par cette tentative (aucun doc créé). */
function nothingPosted(a: NonNullable<Awaited<ReturnType<typeof getSession>>>["adjustment"]): boolean {
  return !a || (a.sapExitDocNum == null && a.sapEntryDocNum == null);
}

/**
 * Session VERROUILLÉE = stock réellement régularisé dans SAP. Un ajustement qui a
 * ÉCHOUÉ sans rien poster (ex. sortie SAP refusée) ne verrouille PAS : l'inventaire
 * reste corrigeable et re-régularisable. Une réussite, ou un échec PARTIEL (un doc
 * déjà posté), verrouille pour éviter un double mouvement.
 */
function isLocked(s: NonNullable<Awaited<ReturnType<typeof getSession>>>): boolean {
  if (s.status !== "adjusted" || !s.adjustment) return false;
  return !(s.adjustment.status === "error" && nothingPosted(s.adjustment));
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
    // « Déjà ajusté » = VERROUILLÉ : seulement si quelque chose a vraiment été
    // posté dans SAP. Un échec total (rien posté) reste re-tentable.
    alreadyAdjusted: isLocked(s),
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

  // Garde anti-double-écriture : on refuse uniquement si du stock a VRAIMENT été
  // posté (réussite, ou échec PARTIEL avec un doc déjà créé). Un échec TOTAL
  // (rien posté, ex. sortie refusée) ne verrouille pas → on peut re-tenter.
  if (isLocked(s)) {
    return NextResponse.json(
      { error: "Inventaire déjà régularisé.", adjustment: s.adjustment },
      { status: 409 },
    );
  }

  const actor = actorOf(session);
  const adjustment = await executeAdjustment(s, actor);
  const posted = adjustment.sapExitDocNum != null || adjustment.sapEntryDocNum != null;

  // Persiste la trace dans tous les cas (visibilité de la dernière tentative).
  s.adjustment = adjustment;
  if (adjustment.status === "done" || posted) {
    // Réussite, ou échec PARTIEL (un doc posté) → on VERROUILLE (reconcilie dans SAP).
    s.status = "adjusted";
    if (!s.reviewedAt) { s.reviewedAt = adjustment.at; s.reviewedBy = actor; }
  } else {
    // Échec TOTAL (rien posté) → on NE verrouille PAS : l'inventaire reste
    // corrigeable et re-régularisable (l'erreur est conservée pour affichage).
    s.status = "reviewed";
  }
  await saveSession(s);

  const httpStatus = adjustment.status === "error" ? 502 : 200;
  return NextResponse.json({ ok: adjustment.status !== "error", adjustment, locked: isLocked(s) }, { status: httpStatus });
}
