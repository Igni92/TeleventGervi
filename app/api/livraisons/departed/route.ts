import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { setDeliveryDeparted, setDeliveryPrepared, getDeliveryPreparedOne, setDeliveryIncomplete, setDeliveryBonCommande } from "@/lib/inventory";
import { getOrderLotStatus } from "@/lib/orderLots";
import { writeAudit } from "@/lib/audit";

export const dynamic = "force-dynamic";

/**
 * POST /api/livraisons/departed
 *
 * Bascule le statut « départ » (commande partie en livraison) d'un BL, depuis
 * l'écran Détail livraison. Body : { docEntry: number, departed: boolean, force? }.
 * Marquer « départ » implique « faite » (une commande ne part que préparée) →
 * on force `prepared=true` au passage. Persiste par DocEntry (AppSetting).
 *
 * ⚠️ GARDE-FOU LOT (demande métier) : une commande NE PART PAS sans un vrai lot
 * `EM<DocNum>` sur chaque ligne. Si une ligne est encore en attente (vide,
 * EM_PENDING, EM_FAM:<fruit>), le départ est REFUSÉ (409, code LOT_PENDING) avec
 * la liste des articles à affecter — sauf `force:true` (dérogation tracée en
 * audit). Si SAP est illisible, on n'empêche pas le départ (ne pas figer
 * l'entrepôt sur une panne), mais on renvoie un `warning`.
 */
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

  let body: { docEntry?: number; departed?: boolean; force?: boolean };
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: "JSON invalide" }, { status: 400 }); }

  const docEntry = Number(body.docEntry);
  if (!Number.isInteger(docEntry) || docEntry <= 0) return NextResponse.json({ error: "docEntry invalide" }, { status: 400 });
  const departed = body.departed === true;
  const force = body.force === true;
  const me = session.user.name?.trim() || session.user.email || "?";

  // ── Garde-fou : pas de départ sans lot réel sur toutes les lignes ──
  let warning: string | null = null;
  if (departed) {
    const status = await getOrderLotStatus(docEntry);

    // (1) BLOCAGE DUR — aucune ligne sans vrai lot (exigence métier). On met aussi
    //     la commande dans la file d'affectation (« Bons de commande ») pour que
    //     l'opérateur puisse poser les lots manquants immédiatement.
    if (status.pending.length > 0 && !force) {
      await setDeliveryBonCommande(docEntry, true, me).catch(() => { /* mise en file best-effort */ });
      return NextResponse.json({
        ok: false,
        code: "LOT_PENDING",
        error:
          `Départ bloqué : ${status.pending.length} article(s) sans numéro de lot. ` +
          `Affectez les lots (onglet « Bons de commande ») avant le départ.`,
        docEntry,
        docNum: status.docNum,
        pending: status.pending,
      }, { status: 409 });
    }
    if (status.pending.length > 0 && force) {
      // Dérogation explicite : on trace QUI a fait partir un BL sans lot, et lesquels.
      await writeAudit({
        session,
        action: "DEPART_SANS_LOT",
        entity: "SapOrder",
        entityId: String(docEntry),
        summary: `Départ FORCÉ sans lot — DocEntry ${docEntry} (${status.pending.length} article(s))`,
        details: { docEntry, docNum: status.docNum, pending: status.pending },
      }).catch(() => { /* audit best-effort */ });
    }

    if (status.unverified) {
      warning = "Lots non vérifiés (SAP indisponible) : contrôlez que chaque ligne porte bien un lot.";
    }
  }

  try {
    const at = await setDeliveryDeparted(docEntry, departed, me);
    if (departed) {
      // Une commande qui part est forcément préparée — mais si elle l'était déjà,
      // on n'écrase PAS l'auteur du « fait » (le préparateur) avec le livreur.
      const cur = await getDeliveryPreparedOne(docEntry);
      if (!cur?.prepared) await setDeliveryPrepared(docEntry, true, me);
      // …et n'est plus « incomplète — à reprendre » (même règle que la route prepared).
      await setDeliveryIncomplete(docEntry, false);
    }
    return NextResponse.json({ ok: true, docEntry, departed, by: departed ? me : null, at: departed ? at : null, forced: departed && force, warning });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
