import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { sap } from "@/lib/sapb1";
import { unitInfo, saleableAvailable } from "@/lib/gervifrais-calc";

/**
 * GET /api/sap/orders/last?clientId=xxx
 * Renvoie la DERNIÈRE commande SAP du client, sous forme de lignes prêtes à
 * pré-remplir le panier (« rejouer la dernière commande ») : quantité reconvertie
 * en unité d'affichage (colis/kg), prix unitaire, stock dispo par entrepôt.
 */
export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  const clientId = new URL(req.url).searchParams.get("clientId");
  if (!clientId) return NextResponse.json({ error: "clientId requis" }, { status: 400 });

  // CardCodes du client
  const client = await prisma.client.findUnique({ where: { id: clientId }, select: { code: true } });
  const cardCodes: string[] = [];
  if (client?.code) cardCodes.push(client.code);
  try {
    const modes = await prisma.$queryRawUnsafe<{ sapCardCode: string }[]>(
      `SELECT DISTINCT "sapCardCode" FROM "ClientDeliveryMode" WHERE "clientId" = $1`, clientId);
    for (const m of modes) if (m.sapCardCode && !cardCodes.includes(m.sapCardCode)) cardCodes.push(m.sapCardCode);
  } catch { /* ignore */ }
  if (cardCodes.length === 0) return NextResponse.json({ found: false, lines: [] });

  try {
    type Line = { ItemCode: string; ItemDescription?: string; Quantity: number; Price?: number };
    type Ord = { DocNum: number; DocumentLines?: Line[] };
    const filter = cardCodes.map((c) => `CardCode eq '${c.replace(/'/g, "''")}'`).join(" or ");
    const r = await sap.get<{ value: Ord[] }>(
      `Orders?$top=1&$orderby=DocEntry desc&$select=DocNum,DocumentLines&$filter=${encodeURIComponent(filter)}`);
    const order = r.value?.[0];
    if (!order || !(order.DocumentLines?.length)) return NextResponse.json({ found: false, lines: [] });

    // Regroupe par itemCode (une commande peut avoir le même article sur 2 entrepôts)
    const byItem = new Map<string, { qtyPieces: number; price: number; name: string }>();
    for (const l of order.DocumentLines) {
      const e = byItem.get(l.ItemCode) || { qtyPieces: 0, price: l.Price ?? 0, name: l.ItemDescription || l.ItemCode };
      e.qtyPieces += l.Quantity || 0;
      if (l.Price) e.price = l.Price;
      byItem.set(l.ItemCode, e);
    }

    // Détails produits (unité, emballage, stock) depuis la DB
    const codes = Array.from(byItem.keys());
    const prods = await prisma.product.findMany({
      where: { itemCode: { in: codes } },
      select: { itemCode: true, itemName: true, salesUnit: true, salesQtyPerPackUnit: true, manageBatch: true, stocks: true },
    });
    const prodMap = new Map(prods.map((p) => [p.itemCode, p]));

    const lines = codes.map((code) => {
      const e = byItem.get(code)!;
      const p = prodMap.get(code);
      const { packDivisor, displayUnit, priceUnit } = unitInfo(p?.salesUnit, p?.salesQtyPerPackUnit);
      const availByWarehouse: Record<string, number> = {};
      for (const w of ["000", "01", "R1"]) {
        const raw = p?.stocks.find((s) => s.warehouse === w)?.available ?? 0;
        availByWarehouse[w] = saleableAvailable(raw, packDivisor);
      }
      return {
        itemCode: code,
        itemName: p?.itemName || e.name,
        quantity: Math.round((e.qtyPieces / packDivisor) * 100) / 100,   // → colis/kg
        packDivisor,
        displayUnit,
        priceUnit,
        manageBatch: p?.manageBatch ?? false,
        availByWarehouse,
        price: e.price || null,
      };
    });

    return NextResponse.json({ found: true, docNum: order.DocNum, lines });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e), lines: [] }, { status: 500 });
  }
}
