import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { setDeliveryPreparer, setDeliveryPrepared, setDeliveryIncomplete, setDeliveryWaiting } from "@/lib/inventory";

export const dynamic = "force-dynamic";

/**
 * POST /api/livraisons/preparer
 *
 * Affecte / libère le préparateur d'un BL depuis le Détail livraison.
 * Body : { docEntry: number, action: "claim" | "requeue" | "release" }
 *   - claim   : le préparateur connecté s'affecte la commande (l'ouvre en grand).
 *               Lève le signalement « incomplète ».
 *   - requeue : commande PAS entièrement préparée → on la remet sur la file
 *               (préparateur retiré, non « faite ») et on la SIGNALE (incomplète).
 *   - release : retire simplement l'affectation.
 */
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

  let body: { docEntry?: number; action?: string };
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: "JSON invalide" }, { status: 400 }); }

  const docEntry = Number(body.docEntry);
  if (!Number.isFinite(docEntry)) return NextResponse.json({ error: "docEntry requis" }, { status: 400 });

  const me = session.user.name?.trim() || session.user.email || "?";

  try {
    if (body.action === "requeue") {
      // Pas entièrement préparée → retour sur la file + notification. On lève
      // aussi toute mise « en attente » : « à reprendre » remet tout sur la file.
      await setDeliveryPreparer(docEntry, null);
      await setDeliveryPrepared(docEntry, false, me);
      await setDeliveryWaiting(docEntry, false);
      await setDeliveryIncomplete(docEntry, true, me);
      return NextResponse.json({ ok: true, docEntry, preparer: null, incomplete: true, prepared: false });
    }
    if (body.action === "release") {
      await setDeliveryPreparer(docEntry, null);
      return NextResponse.json({ ok: true, docEntry, preparer: null });
    }
    // claim (défaut) : je m'affecte la commande, je lève le « à reprendre ».
    await setDeliveryPreparer(docEntry, me);
    await setDeliveryIncomplete(docEntry, false);
    return NextResponse.json({ ok: true, docEntry, preparer: me, incomplete: false });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
