import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { setDeliveryMiseEnPrep } from "@/lib/inventory";
import { isLivraisonRestricted } from "@/lib/permissions";
import { notifyPreparateurs } from "@/lib/push";

export const dynamic = "force-dynamic";

/**
 * POST /api/livraisons/mise-en-prep
 *
 * Le COMMERCIAL « met en préparation » un magasin depuis le Détail livraison
 * (onglet Ventes) : la commande devient alors visible pour les rôles restreints
 * (préparateur, livreur) ET une NOTIFICATION PUSH est envoyée aux préparateurs
 * abonnés (« nouvelle commande à préparer »). Réservé aux rôles non restreints.
 *
 * Body : { docEntry: number, misEnPrep: boolean, names?: string[] }
 *   ou  { docEntries: number[], misEnPrep: boolean, names?: string[] }
 *   `names` = noms des magasins lâchés (pour le libellé de la notification).
 */
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  const restricted = await isLivraisonRestricted(session);
  if (restricted) return NextResponse.json({ error: "Réservé aux commerciaux" }, { status: 403 });

  let body: { docEntry?: number; docEntries?: number[]; misEnPrep?: boolean; names?: unknown };
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: "JSON invalide" }, { status: 400 }); }

  const entries = (Array.isArray(body.docEntries) ? body.docEntries : [body.docEntry])
    .map(Number)
    .filter((n) => Number.isInteger(n) && n > 0);
  if (!entries.length) return NextResponse.json({ error: "docEntry invalide" }, { status: 400 });
  const misEnPrep = body.misEnPrep === true;
  const me = session.user.name?.trim() || session.user.email || "?";
  const names = Array.isArray(body.names)
    ? body.names.filter((n): n is string => typeof n === "string" && n.trim() !== "").map((n) => n.trim())
    : [];

  try {
    // Upserts indépendants → en PARALLÈLE (l'action groupée peut porter 30-50 BL).
    const stamps = await Promise.all(entries.map((docEntry) => setDeliveryMiseEnPrep(docEntry, misEnPrep, me)));
    const at = stamps[stamps.length - 1] ?? "";

    // ── Notification push aux préparateurs (fire-and-forget, jamais bloquant) ──
    // On ne notifie QUE la mise EN préparation (pas le retrait). Le service
    // worker fait vibrer le téléphone (sw.js : vibrate + showNotification).
    if (misEnPrep) {
      const n = entries.length;
      const label =
        names.length === 1 ? names[0]
        : names.length > 1 ? `${names[0]} +${names.length - 1} autre${names.length - 1 > 1 ? "s" : ""}`
        : `${n} commande${n > 1 ? "s" : ""}`;
      const title = n > 1 ? `🧺 ${n} commandes à préparer` : "🧺 Nouvelle commande à préparer";
      void notifyPreparateurs({
        title,
        body: n > 1 ? `${label} — mises en préparation par ${me}.` : `${label} — mise en préparation par ${me}.`,
        url: "/livraisons",
        tag: "mise-en-prep",
        renotify: true,
      });
    }

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
