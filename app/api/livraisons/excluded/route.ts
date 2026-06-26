import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { setDeliveryExcluded } from "@/lib/inventory";

export const dynamic = "force-dynamic";

/**
 * POST /api/livraisons/excluded
 *
 * Marque/démarque un BL comme « avoir / exclu » (facturé puis avoir total, ou
 * doublon) → il est DÉDUIT à 100% des totaux du Détail livraison.
 * Body : { docEntry: number, excluded: boolean }.
 */
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

  let body: { docEntry?: number; excluded?: boolean };
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: "JSON invalide" }, { status: 400 }); }

  const docEntry = Number(body.docEntry);
  if (!Number.isFinite(docEntry)) return NextResponse.json({ error: "docEntry requis" }, { status: 400 });
  const excluded = body.excluded === true;

  try {
    await setDeliveryExcluded(docEntry, excluded, session.user.email ?? session.user.name ?? "?");
    return NextResponse.json({ ok: true, docEntry, excluded });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
