import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { setDeliveryWaiting, setDeliveryPrepared, setDeliveryDeparted } from "@/lib/inventory";

export const dynamic = "force-dynamic";

/**
 * POST /api/livraisons/waiting
 *
 * Bascule le statut « en attente » (commande PARTIELLE) d'un BL depuis l'écran
 * Détail livraison. Body : { docEntry: number, waiting: boolean, missing?: string[] }.
 *   - waiting=true  : commande partielle → on attend la réception d'un ou
 *                     plusieurs manquants (`missing` = ItemCode(s) attendus).
 *                     Une commande en attente n'est ni « faite » ni « partie » :
 *                     on lève ces deux drapeaux.
 *   - waiting=false : on lève l'attente (la commande retourne « à préparer »).
 * Persiste par DocEntry (AppSetting) — aucune déduction automatique.
 */
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

  let body: { docEntry?: number; waiting?: boolean; missing?: unknown };
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: "JSON invalide" }, { status: 400 }); }

  const docEntry = Number(body.docEntry);
  if (!Number.isFinite(docEntry)) return NextResponse.json({ error: "docEntry requis" }, { status: 400 });
  const waiting = body.waiting === true;
  const missing = Array.isArray(body.missing) ? body.missing.filter((x): x is string => typeof x === "string") : [];
  // Nom-prénom d'abord (affichage « En attente par … »), email en repli.
  const me = session.user.name?.trim() || session.user.email || "?";

  try {
    if (waiting) {
      // Mise en attente : la commande n'est ni finie ni partie.
      await setDeliveryPrepared(docEntry, false, me);
      await setDeliveryDeparted(docEntry, false, me);
    }
    await setDeliveryWaiting(docEntry, waiting, me, missing);
    return NextResponse.json({
      ok: true,
      docEntry,
      waiting,
      by: waiting ? me : null,
      missing: waiting ? missing : [],
    });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
