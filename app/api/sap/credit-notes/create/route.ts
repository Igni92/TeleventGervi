import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { requireAdmin } from "@/lib/permissions";
import { sap } from "@/lib/sapb1";

/**
 * POST /api/sap/credit-notes/create — crée un AVOIR SAP à partir d'une FACTURE,
 * par COPIE partielle (BaseType 13 = Invoice) : on ne reprend que les lignes
 * choisies, avec la quantité choisie. SAP hérite prix/TVA/UDF de la facture →
 * pas de recalcul risqué.
 *
 * ⚠️ Opération COMPTABLE : réservée à la direction (requireAdmin). Écrit sur
 * l'environnement SAP ACTIF (prod par défaut). Atomique : un seul POST.
 *
 * body: { invoiceDocEntry: number, lines: { lineNum: number, quantity: number }[] }
 */
export const dynamic = "force-dynamic";
export const maxDuration = 120;

type Line = { LineNum: number; ItemCode?: string; Quantity?: number };
type Invoice = { DocEntry: number; DocNum: number; CardCode: string; DocumentLines?: Line[] };

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  if (!(await requireAdmin(session))) {
    return NextResponse.json({ error: "Réservé à la direction (création d'avoir)." }, { status: 403 });
  }

  const body = await req.json().catch(() => ({}));
  const invoiceDocEntry = Number(body?.invoiceDocEntry);
  const chosen: { lineNum: number; quantity: number }[] = Array.isArray(body?.lines) ? body.lines : [];
  if (!Number.isInteger(invoiceDocEntry)) return NextResponse.json({ error: "invoiceDocEntry requis." }, { status: 400 });
  const clean = chosen
    .map((l) => ({ lineNum: Number(l.lineNum), quantity: Number(l.quantity) }))
    .filter((l) => Number.isInteger(l.lineNum) && Number.isFinite(l.quantity) && l.quantity > 0);
  if (clean.length === 0) return NextResponse.json({ error: "Sélectionnez au moins une ligne avec une quantité > 0." }, { status: 400 });

  // Facture source (CardCode + lignes pour valider les quantités).
  let invoice: Invoice;
  try {
    invoice = await sap.get<Invoice>(`Invoices(${invoiceDocEntry})?$select=DocEntry,DocNum,CardCode,DocumentLines`);
  } catch (e) {
    return NextResponse.json({ error: `Facture introuvable dans SAP : ${e instanceof Error ? e.message : String(e)}` }, { status: 502 });
  }
  const byLine = new Map((invoice.DocumentLines ?? []).map((l) => [l.LineNum, l]));
  for (const c of clean) {
    const src = byLine.get(c.lineNum);
    if (!src) return NextResponse.json({ error: `Ligne ${c.lineNum} absente de la facture.` }, { status: 400 });
    if (src.Quantity != null && c.quantity > src.Quantity + 1e-6) {
      return NextResponse.json({ error: `Quantité d'avoir (${c.quantity}) > quantité facturée (${src.Quantity}) sur ${src.ItemCode}.` }, { status: 400 });
    }
  }

  try {
    const payload = {
      CardCode: invoice.CardCode,
      DocumentLines: clean.map((c) => ({ BaseType: 13, BaseEntry: invoiceDocEntry, BaseLine: c.lineNum, Quantity: c.quantity })),
    };
    const created = await sap.post<{ DocEntry: number; DocNum: number; DocTotal?: number }>(`/CreditNotes`, payload);
    return NextResponse.json({ ok: true, docEntry: created.DocEntry, docNum: created.DocNum, total: created.DocTotal ?? null, env: sap.getEnvironment().env });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 502 });
  }
}
