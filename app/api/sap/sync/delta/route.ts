import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { sap } from "@/lib/sapb1";
import { refreshItemStocks } from "@/lib/stockSync";

/**
 * POST /api/sap/sync/delta
 *
 * Pull incrémental SAP → DB locale pour les `ProductStock`. Appelé depuis le
 * client (StockPanel, ProductsTable) toutes les 30 s pendant la journée. Plusieurs
 * consoles en parallèle = OK : throttle serveur garantit ≤ 1 pull SAP / 20 s.
 *
 * Mécanique :
 *   1. Lit le curseur singleton (lastOrderDocEntry, lastPdnDocEntry, lastTickAt).
 *   2. Si lastTickAt > now - THROTTLE_MS, no-op (renvoie 200 + throttled=true).
 *   3. SAP Orders + PurchaseDeliveryNotes où DocEntry > cursor → ItemCodes touchés.
 *   4. refreshItemStocks() repull les warehouses et upsert ProductStock.
 *   5. Met à jour le curseur.
 *
 * Limite connue V1 : une annulation seule (sans nouveau doc derrière) n'est pas
 * détectée. À traiter plus tard via Orders?$filter=Cancelled eq 'tYES'.
 */

const THROTTLE_MS = 20_000;

interface DocLine { ItemCode: string }
interface Doc { DocEntry: number; DocumentLines?: DocLine[] }

export async function POST() {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }

  // Singleton cursor (id=1) — créé à la 1ère exécution
  const cursor = await prisma.stockSyncCursor.upsert({
    where: { id: 1 },
    update: {},
    create: { id: 1 },
  });

  if (Date.now() - cursor.lastTickAt.getTime() < THROTTLE_MS) {
    return NextResponse.json({
      ok: true,
      throttled: true,
      lastTickAt: cursor.lastTickAt,
      cursor: {
        lastOrderDocEntry: cursor.lastOrderDocEntry,
        lastPdnDocEntry: cursor.lastPdnDocEntry,
      },
    });
  }

  try {
    const orderPath =
      `Orders?$filter=DocEntry gt ${cursor.lastOrderDocEntry}`
      + `&$orderby=DocEntry asc`
      + `&$select=DocEntry,DocumentLines`;   // DocumentLines en $select, PAS d'$expand (ce SL ne le supporte pas)
    const pdnPath =
      `PurchaseDeliveryNotes?$filter=DocEntry gt ${cursor.lastPdnDocEntry}`
      + `&$orderby=DocEntry asc`
      + `&$select=DocEntry,DocumentLines`;   // DocumentLines en $select, PAS d'$expand (ce SL ne le supporte pas)

    const [orders, pdns] = await Promise.all([
      sap.getAll<Doc>(orderPath, { pageSize: 100, maxPages: 5 }),
      sap.getAll<Doc>(pdnPath, { pageSize: 100, maxPages: 5 }),
    ]);

    const touched = new Set<string>();
    for (const d of orders) for (const l of (d.DocumentLines ?? [])) {
      if (l.ItemCode) touched.add(l.ItemCode);
    }
    for (const d of pdns) for (const l of (d.DocumentLines ?? [])) {
      if (l.ItemCode) touched.add(l.ItemCode);
    }

    const refreshed = await refreshItemStocks(Array.from(touched));

    const maxOrder = orders.length > 0
      ? Math.max(cursor.lastOrderDocEntry, ...orders.map((d) => d.DocEntry))
      : cursor.lastOrderDocEntry;
    const maxPdn = pdns.length > 0
      ? Math.max(cursor.lastPdnDocEntry, ...pdns.map((d) => d.DocEntry))
      : cursor.lastPdnDocEntry;

    await prisma.stockSyncCursor.update({
      where: { id: 1 },
      data: {
        lastOrderDocEntry: maxOrder,
        lastPdnDocEntry: maxPdn,
        lastTickAt: new Date(),
      },
    });

    return NextResponse.json({
      ok: true,
      ordersSeen: orders.length,
      pdnsSeen: pdns.length,
      itemsTouched: touched.size,
      itemsRefreshed: refreshed,
      cursor: { lastOrderDocEntry: maxOrder, lastPdnDocEntry: maxPdn },
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error("[sync/delta]", message);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

/** GET → état courant du curseur (debug). */
export async function GET() {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }
  const cursor = await prisma.stockSyncCursor.findUnique({ where: { id: 1 } });
  return NextResponse.json({ cursor });
}
