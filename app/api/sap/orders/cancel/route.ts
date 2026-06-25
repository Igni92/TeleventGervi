import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getAccessScope, cardCodeInScope } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { sap } from "@/lib/sapb1";
import { mirrorCancelOrder } from "@/lib/sapMirror";

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

  try {
    await sap.post(`Orders(${body.docEntry})/Cancel`, undefined);
    console.log(`[Order] Annulée — DocEntry ${body.docEntry} (DB ${process.env.SAP_B1_COMPANY_DB})`);

    // Miroir : retire la commande des agrégats du jour (cancelled=true) sans
    // attendre de resync — TeleVent est la source de vérité. Non-bloquant.
    try {
      await mirrorCancelOrder(body.docEntry);
    } catch (e) {
      console.warn("[Order] Miroir annulation échoué (non-bloquant):", (e as Error).message);
    }

    return NextResponse.json({ ok: true, docEntry: body.docEntry, cancelled: true });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error("[Order] Cancel failed:", message);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
