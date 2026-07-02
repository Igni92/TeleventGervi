import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { setDeliveryPreparer, setDeliveryPrepared, setDeliveryIncomplete, setDeliveryDeparted, getDeliveryPreparerOne } from "@/lib/inventory";

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
  if (!Number.isInteger(docEntry) || docEntry <= 0) return NextResponse.json({ error: "docEntry invalide" }, { status: 400 });

  const me = session.user.name?.trim() || session.user.email || "?";

  try {
    if (body.action === "requeue") {
      // Pas entièrement préparée → retour sur la file + notification. On lève
      // aussi le « départ » (une commande remise sur la file n'est plus partie),
      // sinon elle resterait classée « Départ » au prochain rechargement.
      await setDeliveryPreparer(docEntry, null);
      await setDeliveryPrepared(docEntry, false, me);
      await setDeliveryDeparted(docEntry, false, me);
      await setDeliveryIncomplete(docEntry, true, me);
      return NextResponse.json({ ok: true, docEntry, preparer: null, incomplete: true, prepared: false, departed: false });
    }
    if (body.action === "release") {
      await setDeliveryPreparer(docEntry, null);
      return NextResponse.json({ ok: true, docEntry, preparer: null });
    }
    // claim (défaut) : je m'affecte la commande, je lève le « à reprendre ».
    // Concurrence : si un AUTRE préparateur l'a déjà prise, on ne l'écrase PAS
    // (sinon double préparation silencieuse) — on renvoie l'affectation en place.
    const current = await getDeliveryPreparerOne(docEntry);
    if (current && current !== me) {
      return NextResponse.json({ ok: true, docEntry, preparer: current, alreadyClaimed: true });
    }
    await setDeliveryPreparer(docEntry, me);
    await setDeliveryIncomplete(docEntry, false);
    return NextResponse.json({ ok: true, docEntry, preparer: me, incomplete: false });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
