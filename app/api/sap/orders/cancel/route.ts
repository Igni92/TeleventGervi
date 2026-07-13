import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getAccessScope, cardCodeInScope } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { sap } from "@/lib/sapb1";
import { mirrorCancelOrder } from "@/lib/sapMirror";
import { writeAudit } from "@/lib/audit";
import { creditLots, isRealLot } from "@/lib/lotLedger";

/**
 * POST /api/sap/orders/cancel
 * Body: { docEntry: number }
 *
 * Annule une commande client SAP (Cancel). Ce n'est PAS une suppression :
 * le document reste dans SAP avec Cancelled=tYES / DocumentStatus=bost_Close.
 * Vérifié en live : POST Orders(DocEntry)/Cancel → 204.
 */
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

  let body: { docEntry?: number };
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: "JSON invalide" }, { status: 400 }); }

  if (!body.docEntry || typeof body.docEntry !== "number") {
    return NextResponse.json({ error: "docEntry requis" }, { status: 400 });
  }

  const ord = await prisma.sapOrder.findUnique({ where: { docEntry: body.docEntry }, select: { cardCode: true } });
  const scope = await getAccessScope(session);
  if (!(await cardCodeInScope(scope, ord?.cardCode))) {
    return NextResponse.json({ error: "Commande hors de votre périmètre" }, { status: 403 });
  }

  // Lignes à lot réel AVANT annulation : on les re-créditera au registre après
  // un Cancel réussi (miroir du débit posé à l'affectation du lot). Sans ça, la
  // vente annulée laisse un débit fantôme sur le lot → stock sous-évalué « qui
  // date ». Best-effort : une lecture en échec ne bloque pas l'annulation.
  type CancelLine = { ItemCode?: string; Quantity?: number; U_NoLot?: string };
  let realLotLines: CancelLine[] = [];
  try {
    const doc = await sap.get<{ DocumentLines?: CancelLine[] }>(
      `Orders(${body.docEntry})?$select=DocumentLines`,
    );
    realLotLines = (doc.DocumentLines ?? []).filter((l) => isRealLot(l.U_NoLot) && (l.Quantity ?? 0) > 0);
  } catch (e) {
    console.warn("[Order] Lecture lignes avant annulation échouée (re-crédit registre ignoré):", (e as Error).message);
  }

  try {
    await sap.post(`Orders(${body.docEntry})/Cancel`, undefined);
    console.log(`[Order] Annulée — DocEntry ${body.docEntry} (DB ${process.env.SAP_B1_COMPANY_DB})`);

    // Re-crédit registre : la marchandise réservée à cette vente revient au lot.
    if (realLotLines.length > 0) {
      try {
        await creditLots(realLotLines.map((l) => ({
          itemCode: l.ItemCode as string,
          lot: (l.U_NoLot as string).trim(),
          qty: l.Quantity as number,
        })));
      } catch (e) {
        console.warn("[Order] Re-crédit registre après annulation échoué (non-bloquant):", (e as Error).message);
      }
    }

    // Miroir : retire la commande des agrégats du jour (cancelled=true) sans
    // attendre de resync — TeleVent est la source de vérité. Non-bloquant.
    try {
      await mirrorCancelOrder(body.docEntry);
    } catch (e) {
      console.warn("[Order] Miroir annulation échoué (non-bloquant):", (e as Error).message);
    }

    await writeAudit({
      session,
      action: "ORDER_CANCEL",
      entity: "SapOrder",
      entityId: String(body.docEntry),
      summary: `Annulation BL — DocEntry ${body.docEntry}`,
      details: { docEntry: body.docEntry, cardCode: ord?.cardCode ?? null },
    });

    return NextResponse.json({ ok: true, docEntry: body.docEntry, cancelled: true });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error("[Order] Cancel failed:", message);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
