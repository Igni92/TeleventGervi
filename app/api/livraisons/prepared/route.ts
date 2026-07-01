import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { setDeliveryPrepared, setDeliveryIncomplete, setDeliveryWaiting } from "@/lib/inventory";

export const dynamic = "force-dynamic";

/**
 * POST /api/livraisons/prepared
 *
 * Bascule MANUELLEMENT le statut « faite » (commande préparée) d'un BL, depuis
 * l'écran Détail livraison. Body : { docEntry: number, prepared: boolean }.
 * Persiste par DocEntry (AppSetting) — aucune déduction automatique.
 */
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

  let body: { docEntry?: number; prepared?: boolean };
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: "JSON invalide" }, { status: 400 }); }

  const docEntry = Number(body.docEntry);
  if (!Number.isFinite(docEntry)) return NextResponse.json({ error: "docEntry requis" }, { status: 400 });
  const prepared = body.prepared === true;
  // Nom-prénom d'abord (affichage « Fait par … »), email en repli.
  const me = session.user.name?.trim() || session.user.email || "?";

  try {
    await setDeliveryPrepared(docEntry, prepared, me);
    // Marquer « faite » lève tout signalement « incomplète — à reprendre » et
    // toute mise « en attente » (le manquant a été réceptionné → commande finie).
    if (prepared) {
      await setDeliveryIncomplete(docEntry, false);
      await setDeliveryWaiting(docEntry, false);
    }
    return NextResponse.json({ ok: true, docEntry, prepared, by: prepared ? me : null });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
