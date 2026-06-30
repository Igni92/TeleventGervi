import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { requireAdmin } from "@/lib/permissions";
import { sap } from "@/lib/sapb1";

/**
 * POST /api/sap/purchase-orders/cancel
 * Body: { docEntry: number }
 *
 * Annule une COMMANDE FOURNISSEUR (PurchaseOrder) non encore réceptionnée.
 * Ce n'est PAS une suppression : le document reste dans SAP avec
 * Cancelled=tYES / DocumentStatus=bost_Close. Refus si déjà réceptionnée
 * (une entrée marchandise a été créée dessus).
 */
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  // #7 — Annuler une commande fournisseur est une écriture de la chaîne d'achat :
  // réservée aux admins / direction (pas accessible à un simple commercial).
  if (!(await requireAdmin(session))) return NextResponse.json({ error: "Réservé à l'administration / direction" }, { status: 403 });

  let body: { docEntry?: number };
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: "JSON invalide" }, { status: 400 }); }

  const docEntry = Number(body.docEntry);
  if (!Number.isFinite(docEntry)) {
    return NextResponse.json({ error: "docEntry requis" }, { status: 400 });
  }

  // Garde-fou : commande existante et non clôturée (pas déjà réceptionnée).
  type Po = { DocNum: number; DocumentStatus?: string; Cancelled?: string };
  let po: Po;
  try {
    po = await sap.get<Po>(`PurchaseOrders(${docEntry})?$select=DocNum,DocumentStatus,Cancelled`);
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: `Commande fournisseur introuvable : ${e instanceof Error ? e.message : ""}` },
      { status: 404 },
    );
  }
  if (po.Cancelled === "tYES") {
    return NextResponse.json({ ok: true, docEntry, docNum: po.DocNum, cancelled: true, already: true });
  }
  if (po.DocumentStatus === "bost_Close") {
    return NextResponse.json(
      { ok: false, error: "Commande déjà réceptionnée (entrée marchandise créée) — annulation impossible." },
      { status: 409 },
    );
  }

  try {
    await sap.post(`PurchaseOrders(${docEntry})/Cancel`, undefined);
    console.log(`[PO] Annulée — DocEntry ${docEntry} (DB ${process.env.SAP_B1_COMPANY_DB})`);
    return NextResponse.json({ ok: true, docEntry, docNum: po.DocNum, cancelled: true });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error(`[PO] Cancel(${docEntry}) échoué:`, message);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
