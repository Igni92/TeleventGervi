import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { setDeliveryPrepared, setDeliveryPreparedBy, setDeliveryIncomplete } from "@/lib/inventory";

export const dynamic = "force-dynamic";

/**
 * POST /api/livraisons/prepared
 *
 * Bascule MANUELLEMENT le statut « faite » (commande préparée) d'un BL, depuis
 * l'écran Détail livraison. Body : { docEntry: number, prepared: boolean }.
 * Persiste par DocEntry (AppSetting) — aucune déduction automatique.
 *
 * Variante RÉ-ATTRIBUTION : { docEntry, by } SANS `prepared` → change uniquement
 * la PERSONNE qui a fait la commande (l'heure du clic d'origine est conservée).
 */
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

  let body: { docEntry?: number; prepared?: boolean; by?: string };
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: "JSON invalide" }, { status: 400 }); }

  const docEntry = Number(body.docEntry);
  if (!Number.isInteger(docEntry) || docEntry <= 0) return NextResponse.json({ error: "docEntry invalide" }, { status: 400 });

  // ── Ré-attribution de l'auteur du « fait » (sans toucher au statut) ──
  if (body.prepared === undefined && typeof body.by === "string") {
    const by = body.by.trim();
    if (!by) return NextResponse.json({ error: "by invalide" }, { status: 400 });
    try {
      const ok = await setDeliveryPreparedBy(docEntry, by);
      if (!ok) return NextResponse.json({ ok: false, error: "Commande non marquée « faite »" }, { status: 409 });
      return NextResponse.json({ ok: true, docEntry, by });
    } catch (e) {
      return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
    }
  }

  const prepared = body.prepared === true;
  // Nom-prénom d'abord (affichage « Fait par … »), email en repli.
  const me = session.user.name?.trim() || session.user.email || "?";

  try {
    const at = await setDeliveryPrepared(docEntry, prepared, me);
    // Marquer « faite » lève tout signalement « incomplète — à reprendre ».
    if (prepared) await setDeliveryIncomplete(docEntry, false);
    return NextResponse.json({ ok: true, docEntry, prepared, by: prepared ? me : null, at: prepared ? at : null });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
