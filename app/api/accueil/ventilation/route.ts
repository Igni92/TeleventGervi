import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getVentilationJour } from "@/lib/accueilData";

export const dynamic = "force-dynamic";

/**
 * GET /api/accueil/ventilation → { ok, totals, families:[…], orders:[…] }
 *
 * Ventilation des ventes du jour (CA + poids par famille, et par commande) —
 * alimente les bulles de survol des KPI accueil (part du volume / du CA).
 */
export async function GET() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  try {
    return NextResponse.json({ ok: true, ...(await getVentilationJour()) });
  } catch (e) {
    // Audit 2026-08-13 (#16) : vrai HTTP 500 sur exception (le front useJson ne
    // détecte l'erreur que sur un statut non-2xx, pas sur le champ `ok`) — sinon
    // un 200 à zéros masquerait la panne derrière une ventilation vide.
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : String(e), totals: { weightKg: 0, caEur: 0, ordersCount: 0 }, families: [], orders: [] },
      { status: 500 },
    );
  }
}
