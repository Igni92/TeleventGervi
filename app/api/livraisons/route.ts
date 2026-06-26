import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { sap } from "@/lib/sapb1";
import { colisInfo } from "@/lib/colis";
import { nextDeliveryDate, frenchHolidayLabel } from "@/lib/livraison";
import { getPrepStatus } from "@/lib/inventory";

export const dynamic = "force-dynamic";

/**
 * GET /api/livraisons?date=YYYY-MM-DD
 *
 * « Détail livraison » — toutes les commandes SAP (Sales Orders) dont la date
 * de livraison prévue (DocDueDate) tombe le jour ciblé. Par défaut : la
 * prochaine livraison (J+1, sauf le samedi → J+2). La date est surchargeable
 * (jours fériés) côté front et passée ici en clair.
 *
 * Enrichissement local : nb de colis EXACT + poids net par commande/ligne
 * (depuis Product, comme /api/sap/orders) et libellé transporteur (U_TrspCode
 * résolu via la table Carrier). Les commandes annulées sont exclues.
 *
 * Réponse : { ok, db, date, holiday, count, totals, carriers[] }
 *   carriers[] = commandes groupées par transporteur (tri colis desc, « Non
 *   affecté » en dernier).
 */
export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const dateParam = searchParams.get("date");
  const date = /^\d{4}-\d{2}-\d{2}$/.test(dateParam ?? "") ? (dateParam as string) : nextDeliveryDate();

  type ListedLine = {
    ItemCode: string;
    ItemDescription?: string;
    Quantity: number;
    WarehouseCode?: string;
    LineTotal?: number;
  };
  type SapOrderListed = {
    DocEntry: number;
    DocNum: number;
    DocDate: string;
    DocDueDate: string;
    CardCode: string;
    CardName?: string;
    DocTotal?: number;
    VatSum?: number;
    DocumentStatus?: string;
    Cancelled?: string;
    Comments?: string;
    NumAtCard?: string;
    U_TrspCode?: string;
    U_TrspHeur?: string;
    DocumentLines?: ListedLine[];
  };

  const filter = encodeURIComponent(`DocDueDate eq '${date}'`);
  const BASE_SELECT =
    "DocEntry,DocNum,DocDate,DocDueDate,CardCode,CardName,DocTotal,VatSum,DocumentStatus,Cancelled,Comments,NumAtCard,DocumentLines";

  try {
    // U_TrspCode (transporteur) est un champ custom : on l'inclut, mais on
    // retombe sur le select de base si le Service Layer le refuse (DB sans ce
    // champ) — la livraison reste lisible, simplement « Non affecté ».
    let orders: SapOrderListed[];
    try {
      orders = await sap.getAll<SapOrderListed>(
        `Orders?$select=${BASE_SELECT},U_TrspCode,U_TrspHeur&$filter=${filter}&$orderby=CardName asc`,
        { pageSize: 200, maxPages: 20 },
      );
    } catch {
      orders = await sap.getAll<SapOrderListed>(
        `Orders?$select=${BASE_SELECT}&$filter=${filter}&$orderby=CardName asc`,
        { pageSize: 200, maxPages: 20 },
      );
    }

    const live = orders.filter((o) => o.Cancelled !== "tYES");

    // ── Référentiels locaux : produits (poids/colis) + transporteurs ──
    const allItemCodes = Array.from(
      new Set(live.flatMap((d) => (d.DocumentLines || []).map((l) => l.ItemCode))),
    );
    const prods = allItemCodes.length
      ? await prisma.product.findMany({
          where: { itemCode: { in: allItemCodes } },
          select: {
            itemCode: true,
            itemName: true,
            frgnName: true,
            salesUnit: true,
            salesUnitWeight: true,
            salesQtyPerPackUnit: true,
          },
        })
      : [];
    const pMap = new Map(prods.map((p) => [p.itemCode, p]));

    // Transporteur : U_TrspCode (SAP) → libellé app (Carrier.sapValue → name).
    const carrierByCode = new Map<string, string>();
    try {
      const carriers = await prisma.carrier.findMany({ select: { name: true, sapValue: true } });
      for (const c of carriers) if (c.sapValue) carrierByCode.set(c.sapValue, c.name);
    } catch {
      /* table Carrier absente → on affichera le code brut */
    }

    // Statut « faite » depuis la dernière pré-étape d'inventaire : une commande est
    // FAITE si un inventaire récent existe ET qu'elle n'est PAS cochée « non préparée ».
    const { notPrepared, hasPrep } = await getPrepStatus().catch(() => ({ notPrepared: new Set<number>(), hasPrep: false }));

    // Type client (GMS / CHR / EXPORT) par CardCode — pour le filtre par segment.
    // Le CardCode d'un BL peut être le code principal OU un code d'adresse de
    // livraison (ClientDeliveryMode.sapCardCode) : on couvre les deux.
    const cardCodes = Array.from(new Set(live.map((o) => o.CardCode).filter(Boolean)));
    const typeByCardCode = new Map<string, string>();
    if (cardCodes.length) {
      try {
        const clients = await prisma.client.findMany({
          where: { code: { in: cardCodes } },
          select: { code: true, type: true },
        });
        for (const c of clients) if (c.type) typeByCardCode.set(c.code, c.type);
        const modes = await prisma.clientDeliveryMode.findMany({
          where: { sapCardCode: { in: cardCodes } },
          select: { sapCardCode: true, client: { select: { type: true } } },
        });
        for (const m of modes) {
          if (m.client?.type && !typeByCardCode.has(m.sapCardCode)) typeByCardCode.set(m.sapCardCode, m.client.type);
        }
      } catch {
        /* type optionnel → le filtre rangera ces BL en « Autres » */
      }
    }

    const weightOfItem = (code: string) => pMap.get(code)?.salesUnitWeight ?? 0;
    const colisDivOf = (code: string) => {
      const p = pMap.get(code);
      return p ? colisInfo(p).unitsPerColis : 1;
    };

    // ── Mise en forme par commande ──
    const docs = live.map((d) => {
      const lines = (d.DocumentLines || []).map((l) => {
        const p = pMap.get(l.ItemCode);
        const div = colisDivOf(l.ItemCode) || 1;
        return {
          itemCode: l.ItemCode,
          itemName: l.ItemDescription || p?.frgnName || p?.itemName || l.ItemCode,
          quantity: l.Quantity,
          colis: Math.round(((l.Quantity || 0) / div) * 10) / 10,
          weightKg: Math.round((l.Quantity || 0) * weightOfItem(l.ItemCode) * 10) / 10,
          warehouse: l.WarehouseCode ?? null,
        };
      });
      const colis = lines.reduce((s, l) => s + l.colis, 0);
      const weightKg = lines.reduce((s, l) => s + l.weightKg, 0);
      const trspCode = d.U_TrspCode?.trim() || null;
      return {
        docEntry: d.DocEntry,
        docNum: d.DocNum,
        docDate: d.DocDate,
        dueDate: d.DocDueDate,
        cardCode: d.CardCode,
        cardName: d.CardName ?? d.CardCode,
        totalHT: Math.round(((d.DocTotal ?? 0) - (d.VatSum ?? 0)) * 100) / 100,
        totalTTC: Math.round((d.DocTotal ?? 0) * 100) / 100,
        colis: Math.round(colis * 10) / 10,
        weightKg: Math.round(weightKg * 10) / 10,
        open: d.DocumentStatus !== "bost_Close",
        comments: d.Comments ?? "",
        numAtCard: d.NumAtCard ?? "",
        trspCode,
        trspHeure: d.U_TrspHeur?.trim() || null,
        carrierName: trspCode ? carrierByCode.get(trspCode) ?? trspCode : null,
        clientType: typeByCardCode.get(d.CardCode) ?? null,   // GMS | CHR | EXPORT | null
        prepared: hasPrep && !notPrepared.has(d.DocEntry),    // « faite » = pas cochée « non préparée »
        lineCount: lines.length,
        lines,
      };
    })
    // Demande métier : on n'affiche QUE les magasins segmentés (GMS / CHR / EXPORT).
    // Les clients sans segment n'apparaissent pas dans Détail livraison.
    .filter((d) => d.clientType === "GMS" || d.clientType === "CHR" || d.clientType === "EXPORT");

    // ── Regroupement par transporteur ──
    type Doc = (typeof docs)[number];
    const groups = new Map<string, { code: string | null; name: string; docs: Doc[] }>();
    for (const d of docs) {
      const key = d.trspCode ?? "__none__";
      const name = d.carrierName ?? "Non affecté";
      const g = groups.get(key) ?? { code: d.trspCode, name, docs: [] };
      g.docs.push(d);
      groups.set(key, g);
    }
    const carriers = Array.from(groups.values())
      .map((g) => ({
        code: g.code,
        name: g.name,
        orders: g.docs.length,
        colis: Math.round(g.docs.reduce((s, d) => s + d.colis, 0) * 10) / 10,
        weightKg: Math.round(g.docs.reduce((s, d) => s + d.weightKg, 0) * 10) / 10,
        totalHT: Math.round(g.docs.reduce((s, d) => s + d.totalHT, 0) * 100) / 100,
        docs: g.docs,
      }))
      // « Non affecté » toujours en dernier ; sinon tri par volume de colis.
      .sort((a, b) => {
        if (!a.code && b.code) return 1;
        if (a.code && !b.code) return -1;
        return b.colis - a.colis;
      });

    const totals = {
      orders: docs.length,
      clients: new Set(docs.map((d) => d.cardCode)).size,
      colis: Math.round(docs.reduce((s, d) => s + d.colis, 0) * 10) / 10,
      weightKg: Math.round(docs.reduce((s, d) => s + d.weightKg, 0) * 10) / 10,
      totalHT: Math.round(docs.reduce((s, d) => s + d.totalHT, 0) * 100) / 100,
    };

    return NextResponse.json({
      ok: true,
      db: process.env.SAP_B1_COMPANY_DB,
      date,
      holiday: frenchHolidayLabel(date),
      count: docs.length,
      totals,
      carriers,
    });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
