import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { requirePreparateurOrAdmin } from "@/lib/permissions";
import { sap } from "@/lib/sapb1";

/**
 * POST /api/sap/goods-receipts/cancel
 * Body: { docEntry: number }
 *
 * Annule une ENTRÉE MARCHANDISE (PurchaseDeliveryNote) : SAP crée un document
 * d'annulation qui SORT le stock entré (réception inversée). Refus si l'EM est
 * clôturée (une facture A/P a déjà été créée dessus) — dans ce cas il faut
 * passer par un avoir, pas par l'annulation de la réception.
 */
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  // #7 — Annuler une entrée marchandise sort du stock dans SAP : écriture de la
  // chaîne fournisseur, réservée à la préparation / l'administration (pas un commercial).
  if (!(await requirePreparateurOrAdmin(session))) return NextResponse.json({ error: "Réservé à la préparation / l'administration" }, { status: 403 });

  let body: { docEntry?: number };
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: "JSON invalide" }, { status: 400 }); }

  const docEntry = Number(body.docEntry);
  if (!Number.isFinite(docEntry)) {
    return NextResponse.json({ error: "docEntry requis" }, { status: 400 });
  }

  type Pdn = { DocNum: number; DocumentStatus?: string; Cancelled?: string };
  let pdn: Pdn;
  try {
    pdn = await sap.get<Pdn>(`PurchaseDeliveryNotes(${docEntry})?$select=DocNum,DocumentStatus,Cancelled`);
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: `Entrée marchandise introuvable : ${e instanceof Error ? e.message : ""}` },
      { status: 404 },
    );
  }
  if (pdn.Cancelled === "tYES") {
    return NextResponse.json({ ok: true, docEntry, docNum: pdn.DocNum, cancelled: true, already: true });
  }
  if (pdn.DocumentStatus === "bost_Close") {
    return NextResponse.json(
      { ok: false, error: "Entrée marchandise clôturée (facture A/P créée) — passe par un avoir, pas par l'annulation." },
      { status: 409 },
    );
  }

  try {
    await sap.post(`PurchaseDeliveryNotes(${docEntry})/Cancel`, undefined);
    console.log(`[EM] Annulée — DocEntry ${docEntry} (DB ${process.env.SAP_B1_COMPANY_DB})`);
    return NextResponse.json({ ok: true, docEntry, docNum: pdn.DocNum, cancelled: true });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error(`[EM] Cancel(${docEntry}) échoué:`, message);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
