import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { sap } from "@/lib/sapb1";

/** GET /api/sap/invoices/[docEntry] → contenu d'une facture (lecture seule). */
type Line = { ItemCode: string; ItemDescription?: string; Quantity: number; Price?: number; LineTotal?: number; MeasureUnit?: string; WarehouseCode?: string };
type Invoice = { DocEntry: number; DocNum: number; DocDate: string; DocTotal?: number; VatSum?: number; DocumentStatus?: string; DocumentLines: Line[] };

export async function GET(_req: NextRequest, { params }: { params: { docEntry: string } }) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  try {
    const o = await sap.get<Invoice>(`Invoices(${params.docEntry})`);
    return NextResponse.json({
      docEntry: o.DocEntry, docNum: o.DocNum, docDate: o.DocDate,
      total: o.DocTotal ?? 0, totalHT: (o.DocTotal ?? 0) - (o.VatSum ?? 0), status: o.DocumentStatus,
      lines: (o.DocumentLines || []).map((l) => ({
        itemCode: l.ItemCode, itemName: l.ItemDescription, quantity: l.Quantity,
        price: l.Price ?? 0, lineTotal: l.LineTotal ?? 0, unit: l.MeasureUnit, warehouse: l.WarehouseCode,
      })),
    });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
