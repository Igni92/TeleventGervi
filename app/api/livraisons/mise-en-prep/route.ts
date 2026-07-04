import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { setDeliveryMiseEnPrep } from "@/lib/inventory";
import { isRestrictedPreparateur } from "@/lib/preparateur";
import { isLivreur } from "@/lib/permissions";

export const dynamic = "force-dynamic";

/**
 * POST /api/livraisons/mise-en-prep
 *
 * Le COMMERCIAL « met en préparation » un magasin depuis l'état « Ventes du
 * jour » : la commande devient alors visible dans le Détail livraison pour les
 * rôles restreints (préparateur verrouillé, livreur). Réservé aux rôles non
 * restreints — un préparateur ne peut pas se lâcher lui-même une commande.
 *
 * Body : { docEntry: number, misEnPrep: boolean }
 *   ou  { docEntries: number[], misEnPrep: boolean } (action groupée).
 */
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  const restricted = isRestrictedPreparateur(session.user.email) || (await isLivreur(session));
  if (restricted) return NextResponse.json({ error: "Réservé aux commerciaux" }, { status: 403 });

  let body: { docEntry?: number; docEntries?: number[]; misEnPrep?: boolean };
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: "JSON invalide" }, { status: 400 }); }

  const entries = (Array.isArray(body.docEntries) ? body.docEntries : [body.docEntry])
    .map(Number)
    .filter((n) => Number.isInteger(n) && n > 0);
  if (!entries.length) return NextResponse.json({ error: "docEntry invalide" }, { status: 400 });
  const misEnPrep = body.misEnPrep === true;
  const me = session.user.name?.trim() || session.user.email || "?";

  try {
    let at = "";
    for (const docEntry of entries) at = await setDeliveryMiseEnPrep(docEntry, misEnPrep, me);
    return NextResponse.json({
      ok: true,
      docEntries: entries,
      misEnPrep,
      by: misEnPrep ? me : null,
      at: misEnPrep ? at : null,
    });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
