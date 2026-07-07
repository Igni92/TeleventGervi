import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { sap } from "@/lib/sapb1";
import { colisInfo } from "@/lib/colis";
import { getLotMaps, resolveLotForSegment, LOT_PENDING } from "@/lib/lotResolver";
import { getEmAffects } from "@/lib/emAffect";
import { listBonCommandeDocEntries, setDeliveryBonCommande } from "@/lib/inventory";

export const dynamic = "force-dynamic";

/**
 * Onglet « BONS DE COMMANDE » — commandes créées SANS auto-lot (choix explicite,
 * précommande, ou export via son propre flux) : chaque ligne est en EM_PENDING et
 * attend l'affectation MANUELLE d'un lot quand la marchandise est là.
 *
 *   GET   → liste les commandes marquées « bon de commande » (lib/inventory),
 *           avec pour chaque ligne son lot courant + les lots candidats (EM
 *           récents de l'article, cf. /api/lots/candidates).
 *   PATCH → affecte un lot à toutes les lignes d'un article d'une commande
 *           (PATCH U_NoLot côté SAP). Quand plus aucune ligne n'est en attente,
 *           la marque est levée (la commande sort de l'onglet).
 */

type SapLine = {
  LineNum?: number;
  ItemCode: string;
  ItemDescription?: string;
  Quantity?: number;
  WarehouseCode?: string;
  U_NoLot?: string;
};
type SapOrderDoc = {
  DocEntry: number;
  DocNum: number;
  DocDate?: string;
  DocDueDate?: string;
  CardCode: string;
  CardName?: string;
  DocumentStatus?: string;
  Cancelled?: string;
  DocumentLines?: SapLine[];
};

const isPending = (lot: string | undefined | null) => !lot || lot.trim() === "" || lot.trim() === LOT_PENDING;

export async function GET() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

  const marks = await listBonCommandeDocEntries();
  if (marks.length === 0) return NextResponse.json({ ok: true, docs: [] });

  const markInfo = new Map(marks.map((m) => [m.docEntry, m]));
  const docEntries = marks.map((m) => m.docEntry);

  try {
    // Récupère les commandes marquées (par lots de 20 → filtre OData raisonnable).
    const CHUNK = 20;
    const fetched: SapOrderDoc[] = [];
    for (let i = 0; i < docEntries.length; i += CHUNK) {
      const slice = docEntries.slice(i, i + CHUNK);
      const filter = slice.map((n) => `DocEntry eq ${n}`).join(" or ");
      const res = await sap.get<{ value: SapOrderDoc[] }>(
        `Orders?$filter=${encodeURIComponent(filter)}`
        + `&$select=DocEntry,DocNum,DocDate,DocDueDate,CardCode,CardName,DocumentStatus,Cancelled,DocumentLines`,
      );
      for (const d of res.value ?? []) fetched.push(d);
    }
    // On ne garde que les commandes vivantes (non annulées).
    const live = fetched.filter((d) => d.Cancelled !== "tYES");

    // Produits (tags désignation + colisage) pour toutes les lignes.
    const itemCodes = Array.from(new Set(live.flatMap((d) => (d.DocumentLines ?? []).map((l) => l.ItemCode))));
    const pMap = new Map<string, { itemName: string; salesUnit: string | null; salesUnitWeight: number | null;
      salesQtyPerPackUnit: number | null; uMarque: string | null; uCondi: string | null; uPays: string | null }>();
    if (itemCodes.length > 0) {
      const prods = await prisma.product.findMany({
        where: { itemCode: { in: itemCodes } },
        select: { itemCode: true, itemName: true, salesUnit: true, salesUnitWeight: true,
                  salesQtyPerPackUnit: true, uMarque: true, uCondi: true, uPays: true },
      });
      for (const p of prods) pMap.set(p.itemCode, p);
    }
    const unitsPerColis = (code: string) => {
      const p = pMap.get(code);
      return p ? colisInfo(p).unitsPerColis || 1 : 1;
    };

    // Segment client par CardCode (pour la suggestion de lot par segment).
    const cardCodes = Array.from(new Set(live.map((d) => d.CardCode)));
    const typeByCard = new Map<string, string | null>();
    if (cardCodes.length > 0) {
      const clients = await prisma.client.findMany({ where: { code: { in: cardCodes } }, select: { code: true, type: true } });
      for (const c of clients) typeByCard.set(c.code, c.type);
    }

    // Cartes de lots + affectations EM (une fois).
    const [maps, affects] = await Promise.all([getLotMaps(), getEmAffects()]);
    const candidatesFor = (itemCode: string, segment: string | null) => {
      const docs = maps.byItemList.get(itemCode) ?? [];
      const candidates = docs.map((dn) => ({
        lot: `EM${dn}`, docNum: dn,
        warehouse: maps.whsOfItemDoc.get(`${itemCode}|${dn}`) ?? null,
        affect: affects.get(dn) ?? "TOUS",
      }));
      const suggested = resolveLotForSegment(maps, affects, itemCode, undefined, segment).lot;
      return { candidates, suggested };
    };

    const docs = live.map((d) => {
      const segment = (typeByCard.get(d.CardCode) ?? "").trim().toUpperCase() || null;
      // Fusion par article : le lot est le même sur toutes les lignes d'un article
      // (elles seront affectées ensemble). « pending » = au moins une ligne EM_PENDING.
      const byItem = new Map<string, { itemCode: string; itemName: string; quantity: number; colisRaw: number;
        warehouse: string | null; marque: string | null; condt: string | null; pays: string | null;
        lot: string; pending: boolean }>();
      for (const l of d.DocumentLines ?? []) {
        const p = pMap.get(l.ItemCode);
        const qty = l.Quantity ?? 0;
        const g = byItem.get(l.ItemCode);
        const linePending = isPending(l.U_NoLot);
        if (!g) {
          byItem.set(l.ItemCode, {
            itemCode: l.ItemCode,
            itemName: l.ItemDescription || p?.itemName || l.ItemCode,
            quantity: qty,
            colisRaw: qty / (unitsPerColis(l.ItemCode) || 1),
            warehouse: l.WarehouseCode ?? null,
            marque: p?.uMarque ?? null, condt: p?.uCondi ?? null, pays: p?.uPays ?? null,
            lot: linePending ? LOT_PENDING : (l.U_NoLot ?? "").trim(),
            pending: linePending,
          });
        } else {
          g.quantity += qty;
          g.colisRaw += qty / (unitsPerColis(l.ItemCode) || 1);
          if (linePending) { g.pending = true; g.lot = LOT_PENDING; }
        }
      }
      const lines = [...byItem.values()].map((l) => {
        const { candidates, suggested } = candidatesFor(l.itemCode, segment);
        return {
          itemCode: l.itemCode, itemName: l.itemName,
          quantity: l.quantity, colis: Math.round(l.colisRaw * 10) / 10,
          warehouse: l.warehouse, marque: l.marque, condt: l.condt, pays: l.pays,
          lot: l.lot, pending: l.pending, candidates, suggested,
        };
      });
      const mark = markInfo.get(d.DocEntry);
      return {
        docEntry: d.DocEntry, docNum: d.DocNum,
        cardCode: d.CardCode, cardName: d.CardName ?? d.CardCode,
        clientType: segment,
        dueDate: d.DocDueDate ?? null, docDate: d.DocDate ?? null,
        open: d.DocumentStatus !== "bost_Close",
        markedBy: mark?.by ?? null, markedAt: mark?.at ?? null,
        pendingCount: lines.filter((l) => l.pending).length,
        lines,
      };
    })
    // Les commandes entièrement affectées ne devraient plus être marquées, mais on
    // filtre par sécurité (une marque résiduelle ne pollue pas l'onglet).
    .filter((d) => d.pendingCount > 0)
    // Précommandes d'abord (livraison la plus proche en tête).
    .sort((a, b) => (a.dueDate ?? "").localeCompare(b.dueDate ?? ""));

    return NextResponse.json({ ok: true, docs, pending: LOT_PENDING });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}

/**
 * PATCH — affecte un lot à TOUTES les lignes d'un article d'une commande.
 * Body : { docEntry: number, itemCode: string, lot: string }
 * `lot` = "EM<DocNum>" (arrivage choisi) ou "EM_PENDING" (laisser à découvert).
 */
export async function PATCH(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

  let body: { docEntry?: number; itemCode?: string; lot?: string };
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: "JSON invalide" }, { status: 400 }); }

  const docEntry = Number(body.docEntry);
  const itemCode = (body.itemCode ?? "").trim();
  const lot = (body.lot ?? "").trim();
  if (!Number.isInteger(docEntry) || docEntry <= 0) return NextResponse.json({ error: "docEntry invalide" }, { status: 400 });
  if (!itemCode) return NextResponse.json({ error: "itemCode requis" }, { status: 400 });
  if (!lot) return NextResponse.json({ error: "lot requis" }, { status: 400 });

  try {
    const order = await sap.get<SapOrderDoc>(
      `Orders(${docEntry})?$select=DocEntry,DocNum,DocumentLines`,
    );
    const allLines = order.DocumentLines ?? [];
    const patchLines = allLines
      .filter((l) => l.ItemCode === itemCode && l.LineNum != null)
      .map((l) => ({ LineNum: l.LineNum, U_NoLot: lot }));
    if (patchLines.length === 0) {
      return NextResponse.json({ error: `Aucune ligne « ${itemCode} » sur la commande` }, { status: 404 });
    }
    await sap.patch(`Orders(${docEntry})`, { DocumentLines: patchLines });

    // Reste-t-il des lignes en attente après cette affectation ?
    const stillPending = allLines.some((l) => {
      const effLot = l.ItemCode === itemCode ? lot : l.U_NoLot;
      return isPending(effLot);
    });
    if (!stillPending) {
      // Toutes les lignes ont un lot → la commande sort de l'onglet.
      await setDeliveryBonCommande(docEntry, false, "").catch(() => {});
    }
    return NextResponse.json({ ok: true, docEntry, itemCode, lot, cleared: !stillPending });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error(`[BonCommande] PATCH lot ${itemCode}@${docEntry} échoué:`, message);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
