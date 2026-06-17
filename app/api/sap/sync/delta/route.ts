import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
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
  await prisma.stockSyncCursor.upsert({ where: { id: 1 }, update: {}, create: { id: 1 } });

  // Claim ATOMIQUE du tick : l'UPDATE conditionnel ne touche la ligne que si
  // lastTickAt est assez vieux → un seul process franchit la fenêtre de throttle.
  // Évite que plusieurs consoles déclenchent des pulls SAP concurrents (la
  // version précédente lisait puis comparait → course possible).
  const claimed = await prisma.$queryRaw<
    { lastOrderDocEntry: number; lastPdnDocEntry: number }[]
  >(Prisma.sql`
    UPDATE "StockSyncCursor"
       SET "lastTickAt" = now()
     WHERE id = 1 AND "lastTickAt" < now() - make_interval(secs => ${THROTTLE_MS / 1000})
    RETURNING "lastOrderDocEntry", "lastPdnDocEntry"`);

  if (claimed.length === 0) {
    const c = await prisma.stockSyncCursor.findUnique({ where: { id: 1 } });
    return NextResponse.json({
      ok: true,
      throttled: true,
      lastTickAt: c?.lastTickAt,
      cursor: { lastOrderDocEntry: c?.lastOrderDocEntry, lastPdnDocEntry: c?.lastPdnDocEntry },
    });
  }
  const cursor = {
    lastOrderDocEntry: claimed[0].lastOrderDocEntry,
    lastPdnDocEntry: claimed[0].lastPdnDocEntry,
  };

  try {
    // ── Auto-rattrapage du curseur ──────────────────────────────────────────
    // Le curseur peut être TRÈS en retard (ex. seedé à 500 alors que SAP est à
    // 129 000). Crawler l'historique ancien (DocEntry asc, plafonné) ne
    // rattraperait jamais le présent → le stock récent ne se rafraîchit pas.
    // On lit le DocEntry courant le plus haut côté SAP et on ne traite QUE la
    // fenêtre récente : `from = max(curseur, maxActuel − LOOKBACK)`. Le stock de
    // base vient du sync produits ; le delta ne sert qu'à suivre les
    // changements récents. `refreshItemStocks` repull le stock LIVE de l'article.
    const LOOKBACK = 500;
    const latest = (coll: string) =>
      sap.getAll<Doc>(`${coll}?$orderby=DocEntry desc&$select=DocEntry`, { pageSize: 1, maxPages: 1 });
    const [latestOrders, latestPdns] = await Promise.all([latest("Orders"), latest("PurchaseDeliveryNotes")]);
    const maxOrderNow = latestOrders[0]?.DocEntry ?? cursor.lastOrderDocEntry;
    const maxPdnNow = latestPdns[0]?.DocEntry ?? cursor.lastPdnDocEntry;
    const fromOrder = Math.max(cursor.lastOrderDocEntry, maxOrderNow - LOOKBACK);
    const fromPdn = Math.max(cursor.lastPdnDocEntry, maxPdnNow - LOOKBACK);

    const orderPath =
      `Orders?$filter=DocEntry gt ${fromOrder}`
      + `&$orderby=DocEntry asc`
      + `&$select=DocEntry,DocumentLines`;   // DocumentLines en $select, PAS d'$expand (ce SL ne le supporte pas)
    const pdnPath =
      `PurchaseDeliveryNotes?$filter=DocEntry gt ${fromPdn}`
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

    // On avance le curseur au plus haut DocEntry réellement atteint : la borne
    // `from` (rattrapage) si la fenêtre était vide, sinon le max des docs vus.
    // Plafonné par maxXxxNow pour ne pas dépasser ce qui existe côté SAP.
    const maxOrder = Math.min(
      maxOrderNow,
      orders.length > 0 ? Math.max(fromOrder, ...orders.map((d) => d.DocEntry)) : fromOrder,
    );
    const maxPdn = Math.min(
      maxPdnNow,
      pdns.length > 0 ? Math.max(fromPdn, ...pdns.map((d) => d.DocEntry)) : fromPdn,
    );

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
