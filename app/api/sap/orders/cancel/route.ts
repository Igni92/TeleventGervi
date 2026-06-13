import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { sap } from "@/lib/sapb1";

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

  try {
    await sap.post(`Orders(${body.docEntry})/Cancel`, undefined);
    console.log(`[Order] Annulée — DocEntry ${body.docEntry} (DB ${process.env.SAP_B1_COMPANY_DB})`);
    return NextResponse.json({ ok: true, docEntry: body.docEntry, cancelled: true });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error("[Order] Cancel failed:", message);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
