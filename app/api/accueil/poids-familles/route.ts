import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getPoidsFamilles } from "@/lib/accueilData";

export const dynamic = "force-dynamic";

/**
 * GET /api/accueil/poids-familles → { ok, families: [{ key, label, weightKg }] }
 *
 * Poids VENDU aujourd'hui (commandes du jour, hors annulées) par FAMILLE de fruit
 * (fraise, framboise, myrtille…). Poids d'une ligne = quantité × Product.salesUnitWeight
 * (même règle que le KPI « Volume kg »). Servi depuis le miroir et MIS EN CACHE
 * (préfixe `pilotage:`) — purgé + ré-chauffé par le cron mirror à chaque tick
 * (cf. lib/accueilData). Le chargement de l'accueil ne recalcule plus rien.
 */
export async function GET() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  try {
    const families = await getPoidsFamilles();
    return NextResponse.json({ ok: true, families });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e), families: [] });
  }
}
