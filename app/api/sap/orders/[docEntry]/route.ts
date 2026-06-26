import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getAccessScope, cardCodeInScope } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { sap } from "@/lib/sapb1";

/**
 * GET   /api/sap/orders/[docEntry]   → détail d'une commande (lignes) pour affichage/édition
 * PATCH /api/sap/orders/[docEntry]   → modifie les lignes d'une commande OUVERTE
 *   body: { lines: [{ lineNum, quantity?, price? }], numAtCard?, comments? }
 */
type Line = {
  LineNum: number; ItemCode: string; ItemDescription?: string; Quantity: number;
  Price?: number; LineTotal?: number; WarehouseCode?: string; U_NoLot?: string;
  MeasureUnit?: string; LineStatus?: string;
};
type Order = {
  DocEntry: number; DocNum: number; DocDate: string; DocDueDate: string;
  DocTotal?: number; VatSum?: number; CardCode: string; CardName?: string;
  DocumentStatus?: string; NumAtCard?: string; Comments?: string; DocumentLines: Line[];
};

export async function GET(_req: NextRequest, props: { params: Promise<{ docEntry: string }> }) {
  const params = await props.params;
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  const ord = await prisma.sapOrder.findUnique({ where: { docEntry: Number(params.docEntry) }, select: { cardCode: true } });
  const scope = await getAccessScope(session);
  if (!(await cardCodeInScope(scope, ord?.cardCode))) {
    return NextResponse.json({ error: "Commande hors de votre périmètre" }, { status: 403 });
  }
  try {
    const o = await sap.get<Order>(`Orders(${params.docEntry})`);
    return NextResponse.json({
      docEntry: o.DocEntry, docNum: o.DocNum, status: o.DocumentStatus,
      editable: o.DocumentStatus === "bost_Open",
      total: o.DocTotal ?? 0, totalHT: (o.DocTotal ?? 0) - (o.VatSum ?? 0),
      numAtCard: o.NumAtCard ?? "", dueDate: o.DocDueDate,
      lines: (o.DocumentLines || []).map((l) => ({
        lineNum: l.LineNum, itemCode: l.ItemCode, itemName: l.ItemDescription,
        quantity: l.Quantity, price: l.Price ?? 0, lineTotal: l.LineTotal ?? 0,
        unit: l.MeasureUnit, warehouse: l.WarehouseCode, lot: l.U_NoLot ?? null,
      })),
    });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest, props: { params: Promise<{ docEntry: string }> }) {
  const params = await props.params;
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  const ord = await prisma.sapOrder.findUnique({ where: { docEntry: Number(params.docEntry) }, select: { cardCode: true } });
  const scope = await getAccessScope(session);
  if (!(await cardCodeInScope(scope, ord?.cardCode))) {
    return NextResponse.json({ error: "Commande hors de votre périmètre" }, { status: 403 });
  }
  let body: {
    lines?: { lineNum: number; quantity?: number; price?: number }[];
    numAtCard?: string; comments?: string;
    /** Transporteur → ORDR.U_TrspCode. "" / null = désaffecter. */
    trspCode?: string | null;
    /** Date de livraison → ORDR.DocDueDate (format YYYY-MM-DD). */
    dueDate?: string;
  };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "JSON invalide" }, { status: 400 }); }

  const patch: Record<string, unknown> = {};
  if (Array.isArray(body.lines) && body.lines.length > 0) {
    patch.DocumentLines = body.lines.map((l) => {
      const dl: Record<string, unknown> = { LineNum: l.lineNum };
      if (l.quantity != null) dl.Quantity = l.quantity;
      if (l.price != null) { dl.UnitPrice = l.price; dl.Price = l.price; }
      return dl;
    });
  }
  if (body.numAtCard !== undefined) patch.NumAtCard = body.numAtCard.trim();
  if (body.comments !== undefined) patch.Comments = body.comments;
  // Changement de transporteur depuis « Détail livraison ».
  if (body.trspCode !== undefined) patch.U_TrspCode = (body.trspCode ?? "").trim();
  // Changement de date de livraison depuis « Détail livraison ».
  if (typeof body.dueDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.dueDate)) patch.DocDueDate = body.dueDate;

  try {
    await sap.patch(`Orders(${params.docEntry})`, patch);
    const o = await sap.get<Order>(`Orders(${params.docEntry})`);
    return NextResponse.json({ ok: true, total: o.DocTotal ?? 0, totalHT: (o.DocTotal ?? 0) - (o.VatSum ?? 0) });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
