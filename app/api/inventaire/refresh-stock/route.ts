import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { refreshInStockMirror } from "@/lib/stockSync";

export const dynamic = "force-dynamic";

/**
 * POST /api/inventaire/refresh-stock — import du stock SAP AVANT un comptage.
 *
 * Rafraîchit (depuis SAP) le stock des articles « en stock » pour que le
 * préparateur compte contre des quantités à jour. Accessible à tout compte
 * connecté (le préparateur déclenche au clic « Commencer »).
 *
 * PERF : on délègue à refreshInStockMirror() qui tire TOUS les articles en stock
 * en UN appel groupé (filtre serveur `QuantityOnStock gt 0`, pagination
 * parallèle) — au lieu d'une requête SAP par paquet de 20 codes. Même chemin
 * éprouvé que la synchro catalogue → quasi instantané.
 */
export async function POST() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

  try {
    const { refreshed, total } = await refreshInStockMirror();
    return NextResponse.json({ ok: true, refreshed, total });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 502 });
  }
}
