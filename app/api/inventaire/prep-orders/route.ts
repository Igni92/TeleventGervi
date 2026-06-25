import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { sap } from "@/lib/sapb1";
import { colisInfo } from "@/lib/colis";
import { departementOfZip } from "@/lib/geo/zip";

export const dynamic = "force-dynamic";

/**
 * GET /api/inventaire/prep-orders
 *
 * Pré-étape de l'inventaire : liste les commandes SAP OUVERTES des clients
 * d'Île-de-France (déduite du code postal client) avec, par ligne, la quantité
 * encore à livrer convertie en COLIS.
 *
 * Logique métier (validée) : SAP réserve (Committed) la marchandise de toutes
 * les commandes ouvertes → le « disponible » affiché a déjà retiré ces commandes.
 * Or la marchandise des commandes NON PRÉPARÉES est encore physiquement en stock
 * (Hugo la compte). Le préparateur coche donc les commandes non préparées : leur
 * quantité est RÉAJOUTÉE au stock théorique côté client (= stock − préparées).
 */

const IDF = new Set(["75", "77", "78", "91", "92", "93", "94", "95"]);
const INV_WAREHOUSES = new Set(["000", "01", "R1"]); // entrepôts inventoriés

type SapLine = {
  ItemCode: string;
  Quantity?: number;
  RemainingOpenQuantity?: number;
  WarehouseCode?: string | null;
  LineStatus?: string;
};
type SapOrder = {
  DocEntry: number;
  DocNum: number;
  DocDueDate?: string | null;
  CardCode: string;
  CardName?: string | null;
  U_TrspCode?: string | null;
  DocumentLines?: SapLine[];
};

export async function GET() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

  let orders: SapOrder[];
  try {
    orders = await sap.getAll<SapOrder>(
      "Orders?$filter=" +
        encodeURIComponent("DocumentStatus eq 'bost_Open'") +
        "&$orderby=DocDueDate asc" +
        "&$select=DocEntry,DocNum,DocDueDate,CardCode,CardName,U_TrspCode,DocumentLines",
    );
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Erreur SAP (commandes)" },
      { status: 502 },
    );
  }

  // Clients (code postal) — IDF déduite du CP. NB : city/zipCode sont des colonnes
  // créées en raw SQL (cf. lib/pilotageGeo) → lecture via $queryRaw, pas le client typé.
  const cardCodes = [...new Set(orders.map((o) => o.CardCode).filter(Boolean))];
  const cliByCard = new Map<string, { nom: string; zip: string | null; city: string | null }>();
  if (cardCodes.length) {
    const ph = cardCodes.map((_, i) => `$${i + 1}`).join(",");
    const rows = await prisma.$queryRawUnsafe<{ code: string; nom: string; zip: string | null; city: string | null }[]>(
      `SELECT "code","nom","zipCode" AS zip,"city" AS city FROM "Client" WHERE "code" IN (${ph})`,
      ...cardCodes,
    );
    for (const r of rows) cliByCard.set(r.code, { nom: r.nom, zip: r.zip, city: r.city });
  }

  // Produits (nom + emballage) pour la conversion en colis.
  const itemCodes = [
    ...new Set(orders.flatMap((o) => (o.DocumentLines ?? []).map((l) => l.ItemCode)).filter(Boolean)),
  ];
  const products = itemCodes.length
    ? await prisma.product.findMany({
        where: { itemCode: { in: itemCodes } },
        select: {
          itemCode: true, itemName: true,
          salesUnit: true, salesQtyPerPackUnit: true, salesUnitWeight: true,
        },
      })
    : [];
  const prodByCode = new Map(products.map((p) => [p.itemCode, p]));
  const divOf = (code: string) => {
    const p = prodByCode.get(code);
    return (
      colisInfo({
        salesUnit: p?.salesUnit ?? null,
        salesQtyPerPackUnit: p?.salesQtyPerPackUnit ?? null,
        salesUnitWeight: p?.salesUnitWeight ?? null,
      }).unitsPerColis || 1
    );
  };

  const result = [];
  for (const o of orders) {
    const cli = cliByCard.get(o.CardCode);
    const dept = departementOfZip(cli?.zip);
    if (!dept || !IDF.has(dept)) continue; // hors Île-de-France

    const lines = [];
    for (const l of o.DocumentLines ?? []) {
      // On ne réintègre que les entrepôts inventoriés.
      if (l.WarehouseCode && !INV_WAREHOUSES.has(l.WarehouseCode)) continue;
      // Quantité encore à livrer (reste ouvert), repli sur la quantité commandée.
      const qtyUnits =
        l.RemainingOpenQuantity != null && Number.isFinite(l.RemainingOpenQuantity)
          ? l.RemainingOpenQuantity
          : l.Quantity ?? 0;
      if (!(qtyUnits > 0)) continue;
      const p = prodByCode.get(l.ItemCode);
      lines.push({
        itemCode: l.ItemCode,
        itemName: p?.itemName ?? l.ItemCode,
        qtyUnits, // unités SAP (kg/pièce) — réutilisées telles quelles côté client
        colis: Math.round((qtyUnits / divOf(l.ItemCode)) * 10) / 10,
      });
    }
    if (lines.length === 0) continue;

    result.push({
      docEntry: o.DocEntry,
      docNum: o.DocNum,
      cardCode: o.CardCode,
      cardName: cli?.nom ?? o.CardName ?? o.CardCode,
      zip: cli?.zip ?? null,
      dept,
      transport: o.U_TrspCode ?? null,
      docDueDate: o.DocDueDate ?? null,
      lines,
      totalColis: Math.round(lines.reduce((s, l) => s + l.colis, 0) * 10) / 10,
    });
  }

  return NextResponse.json({ orders: result, count: result.length, env: sap.getEnvironment().env });
}
