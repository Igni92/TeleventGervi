import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { sap } from "@/lib/sapb1";
import { colisInfo } from "@/lib/colis";
import { segmentOfGroup } from "@/lib/segments";
import { listSessions } from "@/lib/inventory";

export const dynamic = "force-dynamic";

/**
 * GET /api/inventaire/prep-orders
 *
 * Pré-étape de l'inventaire : liste les commandes SAP OUVERTES susceptibles
 * d'être DÉJÀ PRÉPARÉES, c.-à-d. dont la marchandise s'apprête à quitter le stock.
 * Périmètre métier (validé) :
 *   • clients GMS / EXPORT / CHR (segment déduit du groupe SAP, cf. lib/segments) ;
 *   • livraison prévue à J+1 … J+4 (fenêtre de préparation).
 *
 * Le préparateur COCHE les commandes effectivement préparées : leur quantité (en
 * colis) est RETIRÉE du stock théorique côté écran :
 *   stock théorique = stock physique (inStock) − commandes préparées (cochées).
 * Les commandes non cochées restent comptées (marchandise encore en rayon).
 */

const KEEP_SEGMENTS = new Set(["GMS", "EXPORT", "CHR"]);
const INV_WAREHOUSES = new Set(["000", "01", "R1"]); // entrepôts inventoriés
const DAY_MS = 86_400_000;

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

const parisDay = (d: string | number | Date) =>
  new Date(d).toLocaleDateString("fr-CA", { timeZone: "Europe/Paris" });

export async function GET() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

  // Fenêtre de livraison J+1 … J+4 (jours de Paris).
  const now = Date.now();
  const allowedDueDays = new Set<string>();
  for (let i = 1; i <= 4; i++) allowedDueDays.add(parisDay(now + i * DAY_MS));

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

  // On ne garde d'emblée que les commandes livrées dans la fenêtre J+1…J+4.
  orders = orders.filter((o) => o.DocDueDate && allowedDueDays.has(parisDay(o.DocDueDate)));

  // Commandes DÉJÀ actées « préparées » lors d'un inventaire précédent : c'est
  // acquis, on ne les repropose pas. (On borne aux 21 derniers jours : au-delà,
  // une commande encore ouverte est forcément un cas à revoir.)
  const cutoff = now - 21 * DAY_MS;
  const alreadyPrepared = new Set<number>();
  try {
    for (const s of await listSessions()) {
      if (new Date(s.createdAt).getTime() < cutoff) continue;
      for (const d of s.prep?.preparedDocEntries ?? []) alreadyPrepared.add(d);
    }
  } catch { /* pas de trace → on propose tout */ }
  orders = orders.filter((o) => !alreadyPrepared.has(o.DocEntry));

  // Segment client (GMS/EXPORT/CHR) déduit du groupe SAP. Colonnes lues en raw SQL
  // (groupe & géo non typés dans le client Prisma, cf. lib/pilotageGeo).
  const cardCodes = [...new Set(orders.map((o) => o.CardCode).filter(Boolean))];
  const cliByCard = new Map<string, { nom: string; groupCode: number | null; groupName: string | null }>();
  if (cardCodes.length) {
    const ph = cardCodes.map((_, i) => `$${i + 1}`).join(",");
    const rows = await prisma.$queryRawUnsafe<
      { code: string; nom: string; sapGroupCode: number | null; sapGroupName: string | null }[]
    >(
      `SELECT "code","nom","sapGroupCode","sapGroupName" FROM "Client" WHERE "code" IN (${ph})`,
      ...cardCodes,
    );
    for (const r of rows) cliByCard.set(r.code, { nom: r.nom, groupCode: r.sapGroupCode, groupName: r.sapGroupName });
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
    const segment = segmentOfGroup(cli?.groupName ?? null, cli?.groupCode ?? null);
    if (!segment || !KEEP_SEGMENTS.has(segment)) continue; // hors GMS/EXPORT/CHR

    const lines = [];
    for (const l of o.DocumentLines ?? []) {
      if (l.WarehouseCode && !INV_WAREHOUSES.has(l.WarehouseCode)) continue;
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
      segment,
      transport: o.U_TrspCode ?? null,
      docDueDate: o.DocDueDate ?? null,
      lines,
      totalColis: Math.round(lines.reduce((s, l) => s + l.colis, 0) * 10) / 10,
    });
  }

  // Tri : par date de livraison puis par client.
  result.sort((a, b) => (a.docDueDate ?? "").localeCompare(b.docDueDate ?? "") || a.cardName.localeCompare(b.cardName));

  return NextResponse.json({ orders: result, count: result.length, env: sap.getEnvironment().env });
}
