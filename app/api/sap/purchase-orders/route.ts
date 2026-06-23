import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { sap } from "@/lib/sapb1";

/**
 * GET /api/sap/purchase-orders?last=30
 *
 * Liste les dernières COMMANDES FOURNISSEURS (SAP B1 `PurchaseOrders`).
 * Lecture seule — consultation à côté des Entrées marchandises sur /entrees.
 *
 * Une commande fournisseur précède l'entrée marchandise : c'est l'engagement
 * d'achat. On affiche le statut (Ouverte / Clôturée), la date de commande, la
 * date de livraison prévue (DocDueDate), le fournisseur et le détail des lignes.
 */
export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const last = Math.min(50, parseInt(searchParams.get("last") || "30"));

  try {
    type ListedLine = {
      ItemCode: string; ItemDescription?: string;
      Quantity: number; PackageQuantity?: number;
      WarehouseCode?: string;
      Price?: number;
      LineTotal?: number;
      TaxPercentagePerRow?: number;
      LineStatus?: string;            // bost_Open | bost_Close
    };
    type SapPoListed = {
      DocEntry: number; DocNum: number; DocDate: string; DocDueDate?: string;
      CardCode: string; CardName?: string; NumAtCard?: string;
      DocTotal?: number; VatSum?: number; Comments?: string;
      DocumentStatus?: string;        // bost_Open | bost_Close
      DocumentLines?: ListedLine[];
    };
    const docs = await sap.get<{ value: SapPoListed[] }>(
      `PurchaseOrders?$top=${last}&$orderby=DocEntry desc`
      + `&$select=DocEntry,DocNum,DocDate,DocDueDate,CardCode,CardName,NumAtCard,DocTotal,VatSum,Comments,DocumentStatus,DocumentLines`,
    );

    // Enrichissement local : désignation complète (Fruit/Pays/Marque/Condt) +
    // ratio colis pour reconstituer la quantité « type condt » dans le détail.
    const itemCodes = Array.from(
      new Set((docs.value || []).flatMap((d) => (d.DocumentLines || []).map((l) => l.ItemCode))),
    );
    const products = itemCodes.length
      ? await prisma.product.findMany({
          where: { itemCode: { in: itemCodes } },
          select: {
            itemCode: true, itemName: true, salesQtyPerPackUnit: true, salesPackagingUnit: true,
            uPays: true, uMarque: true, uCondi: true,
          },
        })
      : [];
    const pMap = new Map(products.map((p) => [p.itemCode, p]));

    return NextResponse.json({
      db: process.env.SAP_B1_COMPANY_DB,
      count: docs.value?.length || 0,
      docs: (docs.value || []).map((d) => {
        const lines = d.DocumentLines || [];
        const totalTTC = d.DocTotal ?? 0;
        const totalTVA = d.VatSum ?? 0;
        const sumLines = lines.reduce((s, l) => s + (l.LineTotal ?? 0), 0);
        const totalHT = sumLines > 0 ? sumLines : Math.max(0, totalTTC - totalTVA);
        return {
          docEntry: d.DocEntry,
          docNum: d.DocNum,
          docDate: d.DocDate,
          dueDate: d.DocDueDate ?? null,
          cardCode: d.CardCode,
          cardName: d.CardName,
          numAtCard: d.NumAtCard ?? "",
          open: d.DocumentStatus !== "bost_Close",   // Ouverte tant que non clôturée
          total: totalTTC,
          totalTTC,
          totalHT,
          totalTVA,
          comments: d.Comments ?? "",
          lineCount: lines.length,
          lines: lines.map((l) => {
            const p = pMap.get(l.ItemCode);
            const ratio = (p?.salesQtyPerPackUnit && p.salesQtyPerPackUnit > 1) ? p.salesQtyPerPackUnit : 1;
            return {
              itemCode: l.ItemCode,
              itemName: l.ItemDescription || p?.itemName || l.ItemCode,
              pieceQuantity: l.Quantity,
              packageQuantity: l.PackageQuantity ?? (ratio > 1 ? l.Quantity / ratio : l.Quantity),
              warehouse: l.WarehouseCode,
              price: l.Price ?? null,
              lineTotal: l.LineTotal ?? null,
              taxPercent: l.TaxPercentagePerRow ?? null,
              open: l.LineStatus !== "bost_Close",
              uPays: p?.uPays ?? null,
              uMarque: p?.uMarque ?? null,
              uCondi: p?.uCondi ?? null,
            };
          }),
        };
      }),
    });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
