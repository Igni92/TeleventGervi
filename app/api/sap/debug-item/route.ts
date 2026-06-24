import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { sap } from "@/lib/sapb1";

// TEMPORAIRE — diagnostic : pourquoi un article n'apparaît pas dans le Stock /
// la prise de commande. Compare SAP (Valid/Frozen/groupe/stock) et la base locale.
// Préversion uniquement (404 en prod). À supprimer après usage.
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  if (process.env.VERCEL_ENV === "production") {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const q = new URL(req.url).searchParams.get("q") ?? "GOLDEN";

  try {
    // 1) SAP — tous les Items dont le nom OU le nom étranger contient q (sans filtre Valid/Frozen).
    type W = { WarehouseCode: string; InStock?: number; Committed?: number; Ordered?: number };
    type It = {
      ItemCode: string; ItemName: string; ForeignName?: string; ItemsGroupCode?: number;
      Valid?: string; Frozen?: string; QuantityOnStock?: number;
      QuantityOrderedFromVendors?: number; ItemWarehouseInfoCollection?: W[];
    };
    const filter = `contains(ItemName,'${q.replace(/'/g, "''")}') or contains(ForeignName,'${q.replace(/'/g, "''")}')`;
    const sapRes = await sap.get<{ value: It[] }>(
      `Items?$select=ItemCode,ItemName,ForeignName,ItemsGroupCode,Valid,Frozen,QuantityOnStock,QuantityOrderedFromVendors,ItemWarehouseInfoCollection&$filter=${encodeURIComponent(filter)}&$top=40`,
      { env: "prod" },
    );
    const sapItems = (sapRes.value ?? []).map((it) => ({
      itemCode: it.ItemCode, itemName: it.ItemName, foreignName: it.ForeignName ?? null,
      group: it.ItemsGroupCode ?? null, valid: it.Valid, frozen: it.Frozen,
      qtyOnStock: it.QuantityOnStock ?? 0, qtyOrdered: it.QuantityOrderedFromVendors ?? 0,
      warehouses: (it.ItemWarehouseInfoCollection ?? [])
        .filter((w) => ["000", "01", "R1"].includes(w.WarehouseCode))
        .map((w) => ({ wh: w.WarehouseCode, inStock: w.InStock ?? 0, ordered: w.Ordered ?? 0, committed: w.Committed ?? 0 })),
    }));

    // Compteurs catalogue local (pour comprendre la troncature de la liste).
    const [totalProducts, nonPack, withStock, withCommitted] = await Promise.all([
      prisma.product.count(),
      prisma.product.count({ where: { isPackaging: false } }),
      prisma.product.count({ where: { isPackaging: false, stocks: { some: { available: { gt: 0 } } } } }),
      prisma.product.count({ where: { isPackaging: false, stocks: { some: { committed: { gt: 0 } } } } }),
    ]);
    const counts = { totalProducts, nonPack, withStock, withCommitted };

    // 2) Base locale — Product correspondant (importé ou non ?) + stocks.
    const codes = sapItems.map((s) => s.itemCode);
    const dbProducts = await prisma.product.findMany({
      where: { OR: [{ itemName: { contains: q, mode: "insensitive" } }, { itemCode: { in: codes } }] },
      select: { itemCode: true, itemName: true, itemGroup: true, isPackaging: true, totalStock: true,
        stocks: { select: { warehouse: true, inStock: true, ordered: true, available: true, committed: true } } },
      take: 40,
    });

    return NextResponse.json({ q, sapCount: sapItems.length, sap: sapItems, dbCount: dbProducts.length, db: dbProducts, counts });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
