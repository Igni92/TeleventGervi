import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getArticleNotes } from "@/lib/marchandiseNote";

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
