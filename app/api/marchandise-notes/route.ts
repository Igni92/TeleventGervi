import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { requireCanReceivePurchaseOrder } from "@/lib/permissions";
import {
  getArticleNotes, getLotNotesForItems, setMarchandiseNote, clearMarchandiseNote, sanitizeRating,
} from "@/lib/marchandiseNote";

export const dynamic = "force-dynamic";

/**
 * NOTES QUALITÉ de la marchandise (1..5 étoiles), saisies à la réception et
 * corrigibles a posteriori depuis le détail d'une entrée marchandise.
 *
 * GET /api/marchandise-notes
 *     → { notes: { [itemCode]: rating } }  — notes COURANTES par article (console).
 * GET /api/marchandise-notes?lot=EM14878&items=CODE1,CODE2
 *     → { notes: { [itemCode]: rating } }  — notes de CE lot, par article (détail EM).
 * POST /api/marchandise-notes  { itemCode, lot, rating }
 *     → { ok } — enregistre (rating 1..5) ou efface (rating null) la note du lot.
 *
 * Lecture : toute session connectée. Écriture : préparation / administration OU
 * agréeur (celui qui contrôle la qualité à l'arrivée).
 */
export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

  const lot = req.nextUrl.searchParams.get("lot")?.trim() || "";
  if (lot) {
    const items = (req.nextUrl.searchParams.get("items") ?? "").split(",").map((c) => c.trim()).filter(Boolean);
    const map = await getLotNotesForItems(lot, items);
    const notes: Record<string, number> = {};
    for (const [code, rating] of map) notes[code] = rating;
    return NextResponse.json({ notes });
  }

  const map = await getArticleNotes();
  const notes: Record<string, number> = {};
  for (const [code, rating] of map) notes[code] = rating;
  return NextResponse.json({ notes });
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  if (!(await requireCanReceivePurchaseOrder(session))) {
    return NextResponse.json({ error: "Réservé à la préparation / l'administration / l'agréeur" }, { status: 403 });
  }

  let body: { itemCode?: string; lot?: string | null; rating?: number | null };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "JSON invalide" }, { status: 400 });
  }

  const itemCode = (body.itemCode ?? "").trim();
  if (!itemCode) return NextResponse.json({ error: "itemCode requis" }, { status: 400 });
  const lot = body.lot?.trim() || null;

  if (body.rating == null) {
    await clearMarchandiseNote(itemCode, lot);
    return NextResponse.json({ ok: true, itemCode, rating: null });
  }
  const rating = sanitizeRating(body.rating);
  if (rating == null) return NextResponse.json({ error: "Note invalide (1 à 5)" }, { status: 400 });

  await setMarchandiseNote(itemCode, lot, rating, session.user?.email ?? null);
  return NextResponse.json({ ok: true, itemCode, rating });
}
