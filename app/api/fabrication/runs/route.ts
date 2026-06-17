import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getAccessScope } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { uniteGestion } from "@/lib/fabrication-optim";

/**
 * GET /api/fabrication/runs?last=12
 *
 * Historique des runs de fabrication (traçabilité locale) : date, parent,
 * colis, coût, lots affectés par famille, n° de documents SAP, statut.
 * L'unité de gestion réelle (colis/barquette) de chaque article est résolue
 * à la lecture via Product (pas de colonne dédiée sur FabricationRunLine).
 *
 * Raw SQL : FabricationRun/FabricationRunLine inconnues du client Prisma généré.
 */

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

  // Coût total / valeur parent / prix d'achat ligne → admins seuls.
  const admin = (await getAccessScope(session)).all;

  const { searchParams } = new URL(req.url);
  const last = Math.min(50, Math.max(1, parseInt(searchParams.get("last") || "12")));

  type RunRow = {
    id: string; opCode: string | null; parentItemCode: string; parentItemName: string | null;
    parentColis: number; warehouseCode: string; totalCost: number | null; parentValue: number | null;
    status: string; error: string | null;
    sapExitDocNum: number | null; sapEntryDocNum: number | null;
    createdAt: Date; createdBy: string | null;
  };
  const runs = await prisma.$queryRawUnsafe<RunRow[]>(
    `SELECT "id", "opCode", "parentItemCode", "parentItemName", "parentColis",
            "warehouseCode", "totalCost", "parentValue", "status", "error",
            "sapExitDocNum", "sapEntryDocNum", "createdAt", "createdBy"
       FROM "FabricationRun"
      ORDER BY "createdAt" DESC
      LIMIT $1;`,
    last,
  );
  if (runs.length === 0) return NextResponse.json({ ok: true, runs: [] });

  type LineRow = {
    runId: string; family: string; familyLabel: string | null;
    itemCode: string; itemName: string | null; batchNumber: string;
    colisQty: number; purchasePrice: number | null;
  };
  const lines = await prisma.$queryRawUnsafe<LineRow[]>(
    `SELECT "runId", "family", "familyLabel", "itemCode", "itemName",
            "batchNumber", "colisQty", "purchasePrice"
       FROM "FabricationRunLine"
      WHERE "runId" = ANY($1::text[])
      ORDER BY "familyLabel" ASC;`,
    runs.map((r) => r.id),
  );
  const byRun = new Map<string, LineRow[]>();
  for (const l of lines) {
    const arr = byRun.get(l.runId) ?? [];
    arr.push(l);
    byRun.set(l.runId, arr);
  }

  // Unité de gestion réelle (colis / barquette) — résolue via Product.
  const allCodes = Array.from(new Set([
    ...runs.map((r) => r.parentItemCode),
    ...lines.map((l) => l.itemCode),
  ]));
  type UnitRow = {
    itemCode: string; salesUnit: string | null; inventoryUnit: string | null;
    salesUnitWeight: number | null; salesQtyPerPackUnit: number | null; salesItemsPerUnit: number | null;
  };
  const unitRows = allCodes.length > 0
    ? await prisma.$queryRawUnsafe<UnitRow[]>(
        `SELECT "itemCode", "salesUnit", "inventoryUnit", "salesUnitWeight",
                "salesQtyPerPackUnit", "salesItemsPerUnit"
           FROM "Product" WHERE "itemCode" = ANY($1::text[]);`,
        allCodes,
      )
    : [];
  const uniteByCode = new Map(unitRows.map((u) => [u.itemCode, uniteGestion({
    salesUnit: u.salesUnit,
    inventoryUnit: u.inventoryUnit,
    salesUnitWeight: u.salesUnitWeight != null ? Number(u.salesUnitWeight) : null,
    salesQtyPerPackUnit: u.salesQtyPerPackUnit != null ? Number(u.salesQtyPerPackUnit) : null,
    salesItemsPerUnit: u.salesItemsPerUnit != null ? Number(u.salesItemsPerUnit) : null,
  })]));
  const uniteColisOf = (code: string) => uniteByCode.get(code)?.uniteColis ?? "colis";

  return NextResponse.json({
    ok: true,
    runs: runs.map((r) => ({
      ...r,
      parentColis: Number(r.parentColis),
      parentUniteColis: uniteColisOf(r.parentItemCode),
      totalCost: admin ? (r.totalCost != null ? Number(r.totalCost) : null) : undefined,
      parentValue: admin ? (r.parentValue != null ? Number(r.parentValue) : null) : undefined,
      lines: (byRun.get(r.id) ?? []).map((l) => ({
        family: l.family,
        familyLabel: l.familyLabel,
        itemCode: l.itemCode,
        itemName: l.itemName,
        batchNumber: l.batchNumber,
        colisQty: Number(l.colisQty),
        uniteColis: uniteColisOf(l.itemCode),
        purchasePrice: admin ? (l.purchasePrice != null ? Number(l.purchasePrice) : null) : undefined,
      })),
    })),
  });
}
