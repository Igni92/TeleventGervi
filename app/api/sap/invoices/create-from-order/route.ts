import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { requireAdmin } from "@/lib/permissions";
import { sap } from "@/lib/sapb1";

/**
 * POST /api/sap/invoices/create-from-order — crée une FACTURE SAP à partir d'un BL
 * (commande SAP) par COPIE (BaseType 17). SAP recopie articles/quantités/prix/UDF
 * (U_NoLot), TPF et TVA depuis la commande → pas de recalcul risqué.
 *
 * ⚠️ Opération COMPTABLE : réservée à la direction (requireAdmin). Écrit sur
 * l'environnement SAP ACTIF (prod par défaut — vérifier la bascule prod/test).
 * Garde-fou ANTI-DOUBLON : refuse si une facture référence déjà cette commande.
 * Atomique : un seul POST — en cas d'échec, rien n'est créé.
 */
export const dynamic = "force-dynamic";
export const maxDuration = 120;

type Line = { LineNum: number; BaseType?: number; BaseEntry?: number };
type Ord = { DocEntry: number; DocNum: number; CardCode: string; DocumentStatus?: string; DocumentLines?: Line[] };
type Inv = { DocEntry: number; DocNum: number; DocumentLines?: { BaseType?: number; BaseEntry?: number }[] };

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  if (!(await requireAdmin(session))) {
    return NextResponse.json({ error: "Réservé à la direction (création de facture)." }, { status: 403 });
  }

  const body = await req.json().catch(() => ({}));
  const orderDocEntry = Number(body?.orderDocEntry);
  if (!Number.isInteger(orderDocEntry)) {
    return NextResponse.json({ error: "orderDocEntry requis." }, { status: 400 });
  }

  // 1) Commande source (CardCode + lignes).
  let order: Ord;
  try {
    order = await sap.get<Ord>(`Orders(${orderDocEntry})?$select=DocEntry,DocNum,CardCode,DocumentStatus,DocumentLines`);
  } catch (e) {
    return NextResponse.json({ error: `Commande introuvable dans SAP : ${e instanceof Error ? e.message : String(e)}` }, { status: 502 });
  }
  const cardCode = order.CardCode;
  const lines = (order.DocumentLines ?? []).filter((l) => Number.isInteger(l.LineNum));
  if (lines.length === 0) {
    return NextResponse.json({ error: "La commande n'a aucune ligne à facturer." }, { status: 400 });
  }

  // 2) Garde-fou ANTI-DOUBLON : une facture référence-t-elle déjà cette commande ?
  try {
    const esc = cardCode.replace(/'/g, "''");
    const invoices = await sap.getAll<Inv>(
      `Invoices?$select=DocEntry,DocNum,DocumentLines&$filter=${encodeURIComponent(`CardCode eq '${esc}'`)}`,
      { maxPages: 8 },
    );
    for (const f of invoices) {
      for (const l of f.DocumentLines ?? []) {
        if (l.BaseType === 17 && l.BaseEntry === orderDocEntry) {
          return NextResponse.json({ error: `Ce BL est DÉJÀ facturé (facture N° ${f.DocNum}).`, alreadyInvoiced: f.DocNum }, { status: 409 });
        }
      }
    }
  } catch {
    // Vérification impossible (SAP) → on refuse par prudence (éviter un doublon).
    return NextResponse.json({ error: "Vérification anti-doublon impossible (SAP). Réessayez." }, { status: 502 });
  }

  // 3) Création par COPIE (BaseType 17 = Order).
  try {
    const payload = {
      CardCode: cardCode,
      DocumentLines: lines.map((l) => ({ BaseType: 17, BaseEntry: orderDocEntry, BaseLine: l.LineNum })),
    };
    const created = await sap.post<{ DocEntry: number; DocNum: number; DocTotal?: number }>(`/Invoices`, payload);
    return NextResponse.json({ ok: true, docEntry: created.DocEntry, docNum: created.DocNum, total: created.DocTotal ?? null, env: sap.getEnvironment().env });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 502 });
  }
}
