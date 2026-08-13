import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getMargeKgFamilles } from "@/lib/accueilData";

export const dynamic = "force-dynamic";

/**
 * GET /api/accueil/marge-kg → { ok, overall:{margeKg,weightKg,margeEur}, families:[…] }
 *
 * Marge € par kg vendu aujourd'hui, globale + par famille de fruit. Marge sur le
 * coût réel d'entrée marchandise (cf. lib/cogs / accueilData). Servi depuis le
 * cache miroir (préfixe `pilotage:`).
 */
export async function GET() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  try {
    return NextResponse.json({ ok: true, ...(await getMargeKgFamilles()) });
  } catch (e) {
    // Audit 2026-08-13 (#16) : vrai HTTP 500 sur exception (le front useJson ne
    // détecte l'erreur que sur un statut non-2xx, pas sur le champ `ok`) — sinon
    // un 200 à zéros afficherait une marge nulle au lieu de signaler la panne.
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : String(e), overall: { margeKg: 0, weightKg: 0, margeEur: 0 }, families: [] },
      { status: 500 },
    );
  }
}
