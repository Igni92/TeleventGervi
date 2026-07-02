import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { setDeliveryDeparted, setDeliveryPrepared, getDeliveryPreparedOne, setDeliveryIncomplete } from "@/lib/inventory";

export const dynamic = "force-dynamic";

/**
 * POST /api/livraisons/departed
 *
 * Bascule le statut « départ » (commande partie en livraison) d'un BL, depuis
 * l'écran Détail livraison. Body : { docEntry: number, departed: boolean }.
 * Marquer « départ » implique « faite » (une commande ne part que préparée) →
 * on force `prepared=true` au passage. Persiste par DocEntry (AppSetting).
 */
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

  let body: { docEntry?: number; departed?: boolean };
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: "JSON invalide" }, { status: 400 }); }

  const docEntry = Number(body.docEntry);
  if (!Number.isInteger(docEntry) || docEntry <= 0) return NextResponse.json({ error: "docEntry invalide" }, { status: 400 });
  const departed = body.departed === true;
  const me = session.user.name?.trim() || session.user.email || "?";

  try {
    await setDeliveryDeparted(docEntry, departed, me);
    if (departed) {
      // Une commande qui part est forcément préparée — mais si elle l'était déjà,
      // on n'écrase PAS l'auteur du « fait » (le préparateur) avec le livreur.
      const cur = await getDeliveryPreparedOne(docEntry);
      if (!cur?.prepared) await setDeliveryPrepared(docEntry, true, me);
      // …et n'est plus « incomplète — à reprendre » (même règle que la route prepared).
      await setDeliveryIncomplete(docEntry, false);
    }
    return NextResponse.json({ ok: true, docEntry, departed, by: departed ? me : null });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
