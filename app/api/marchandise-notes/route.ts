import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { requireCanReceivePurchaseOrder } from "@/lib/permissions";
import { getArticleNotes, setMarchandiseNote, sanitizeRating, clearLotNote } from "@/lib/marchandiseNote";

export const dynamic = "force-dynamic";

/**
 * GET /api/marchandise-notes
 * Notes QUALITÉ courantes par article (1..5 étoiles), saisies à la réception —
 * consommé par la console pour afficher les étoiles sur chaque ligne stock.
 * Seuls les articles notés remontent → charge utile minime.
 *   → { notes: { [itemCode]: rating } }
 */
export async function GET() {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

  const map = await getArticleNotes();
  const notes: Record<string, number> = {};
  for (const [code, rating] of map) notes[code] = rating;
  return NextResponse.json({ notes });
}

/**
 * POST /api/marchandise-notes  { itemCode, lot, rating }
 *
 * Pose (ou EFFACE si rating=null/0) la note QUALITÉ d'un PRODUIT sur un LOT
 * précis (« EM<n°> ») — geste de l'AGRÉEUR, ajustable après la réception depuis
 * le détail de l'entrée marchandise. « Une EM par ligne » ⇒ une note par EM.
 * Réservé aux rôles qui réceptionnent (préparation / administration / agréeur).
 */
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  if (!(await requireCanReceivePurchaseOrder(session))) {
    return NextResponse.json({ error: "Réservé à la préparation / l'administration / l'agréeur" }, { status: 403 });
  }

  let body: { itemCode?: string; lot?: string; rating?: number | null };
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: "JSON invalide" }, { status: 400 }); }

  const itemCode = (body.itemCode ?? "").trim();
  const lot = (body.lot ?? "").trim();
  if (!itemCode || !lot) {
    return NextResponse.json({ error: "itemCode et lot requis" }, { status: 400 });
  }
  const by = session.user?.name?.trim() || session.user?.email || null;
  // rating null / 0 → efface la note du lot ; 1..5 → pose la note.
  const rating = sanitizeRating(body.rating);
  try {
    if (rating == null) {
      await clearLotNote(itemCode, lot);
    } else {
      await setMarchandiseNote(itemCode, lot, rating, by);
    }
    return NextResponse.json({ ok: true, itemCode, lot, rating });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
