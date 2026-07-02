import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { setDeliveryMissingItem } from "@/lib/inventory";

export const dynamic = "force-dynamic";

/**
 * POST /api/livraisons/manquants
 *
 * Signale / lève le « MANQUANT » d'un article d'un BL depuis le Détail livraison
 * (rupture constatée au picking). Body : { docEntry: number, itemCode: string,
 * missing: boolean }. Persiste par DocEntry (AppSetting `livmanquant:<docEntry>`).
 * Réponse : { ok, docEntry, itemCode, missing, missingItems: string[] } —
 * `missingItems` = liste à jour des codes articles manquants du BL.
 */
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

  let body: { docEntry?: number; itemCode?: string; missing?: boolean };
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: "JSON invalide" }, { status: 400 }); }

  const docEntry = Number(body.docEntry);
  const itemCode = (body.itemCode ?? "").trim();
  if (!Number.isFinite(docEntry)) return NextResponse.json({ error: "docEntry requis" }, { status: 400 });
  if (!itemCode) return NextResponse.json({ error: "itemCode requis" }, { status: 400 });
  const missing = body.missing === true;
  // Nom-prénom d'abord (affichage « signalé par … »), email en repli.
  const me = session.user.name?.trim() || session.user.email || "?";

  try {
    const items = await setDeliveryMissingItem(docEntry, itemCode, missing, me);
    return NextResponse.json({
      ok: true, docEntry, itemCode, missing,
      missingItems: items.map((i) => i.itemCode),
    });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
