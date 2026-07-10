import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getAccessScope, cardCodeInScope } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { sap } from "@/lib/sapb1";
import { getTransporteurTimbre } from "@/lib/transporteurs";
import { setClientTournee } from "@/lib/clientTournee";

/**
 * GET   /api/sap/orders/[docEntry]   → détail d'une commande (lignes) pour affichage/édition
 * PATCH /api/sap/orders/[docEntry]   → modifie les lignes d'une commande OUVERTE
 *   body: { lines: [{ lineNum, quantity?, price? }], numAtCard?, comments? }
 *   numAtCard : accepté aussi sur un BL CLÔTURÉ (SAP autorise la réf. client
 *   sur document clôturé) — le n° est alors REPORTÉ automatiquement sur la/les
 *   facture(s) créée(s) depuis ce BL (réponse : invoiceNums).
 */
type Line = {
  LineNum: number; ItemCode: string; ItemDescription?: string; Quantity: number;
  Price?: number; LineTotal?: number; WarehouseCode?: string; U_NoLot?: string;
  MeasureUnit?: string; LineStatus?: string;
};
type Order = {
  DocEntry: number; DocNum: number; DocDate: string; DocDueDate: string;
  DocTotal?: number; VatSum?: number; CardCode: string; CardName?: string;
  DocumentStatus?: string; NumAtCard?: string; Comments?: string; DocumentLines: Line[];
};

export async function GET(_req: NextRequest, props: { params: Promise<{ docEntry: string }> }) {
  const params = await props.params;
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  const ord = await prisma.sapOrder.findUnique({ where: { docEntry: Number(params.docEntry) }, select: { cardCode: true } });
  const scope = await getAccessScope(session);
  if (!(await cardCodeInScope(scope, ord?.cardCode))) {
    return NextResponse.json({ error: "Commande hors de votre périmètre" }, { status: 403 });
  }
  try {
    const o = await sap.get<Order>(`Orders(${params.docEntry})`);
    return NextResponse.json({
      docEntry: o.DocEntry, docNum: o.DocNum, status: o.DocumentStatus,
      editable: o.DocumentStatus === "bost_Open",
      total: o.DocTotal ?? 0, totalHT: (o.DocTotal ?? 0) - (o.VatSum ?? 0),
      numAtCard: o.NumAtCard ?? "", dueDate: o.DocDueDate,
      lines: (o.DocumentLines || []).map((l) => ({
        lineNum: l.LineNum, itemCode: l.ItemCode, itemName: l.ItemDescription,
        quantity: l.Quantity, price: l.Price ?? 0, lineTotal: l.LineTotal ?? 0,
        unit: l.MeasureUnit, warehouse: l.WarehouseCode, lot: l.U_NoLot ?? null,
      })),
    });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest, props: { params: Promise<{ docEntry: string }> }) {
  const params = await props.params;
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  const ord = await prisma.sapOrder.findUnique({ where: { docEntry: Number(params.docEntry) }, select: { cardCode: true } });
  const scope = await getAccessScope(session);
  if (!(await cardCodeInScope(scope, ord?.cardCode))) {
    return NextResponse.json({ error: "Commande hors de votre périmètre" }, { status: 403 });
  }
  let body: {
    lines?: { lineNum: number; quantity?: number; price?: number }[];
    numAtCard?: string; comments?: string;
    /** Transporteur → ORDR.U_TrspCode. "" / null = désaffecter. */
    trspCode?: string | null;
    /** Heure de la tournée choisie → ORDR.U_TrspHeur ("HH:MM:SS"). */
    trspHeure?: string | null;
    /** Détails de la tournée choisie → mémorisés pour ce client (auto-remplissage). */
    tournee?: { nom?: string | null; des?: string | null; lineId?: number | null };
    /** Date de livraison → ORDR.DocDueDate (format YYYY-MM-DD). */
    dueDate?: string;
  };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "JSON invalide" }, { status: 400 }); }

  const patch: Record<string, unknown> = {};
  if (Array.isArray(body.lines) && body.lines.length > 0) {
    patch.DocumentLines = body.lines.map((l) => {
      const dl: Record<string, unknown> = { LineNum: l.lineNum };
      if (l.quantity != null) dl.Quantity = l.quantity;
      if (l.price != null) { dl.UnitPrice = l.price; dl.Price = l.price; }
      return dl;
    });
  }
  if (body.numAtCard !== undefined) patch.NumAtCard = body.numAtCard.trim();
  if (body.comments !== undefined) patch.Comments = body.comments;
  // Changement de transporteur depuis « Détail livraison » : pose les 3 champs BL
  //   U_TrspCode (transporteur) + U_TrspHeur (heure de la tournée choisie)
  //   + U_Timbre (timbre du transporteur, résolu côté serveur via SERGTRS —
  //    jamais depuis le client : c'est un montant).
  if (body.trspCode !== undefined) {
    const code = (body.trspCode ?? "").trim();
    patch.U_TrspCode = code;
    if (!code) {
      // « Non affecté » → on remet l'heure et le timbre à zéro pour rester cohérent.
      patch.U_TrspHeur = null;
      patch.U_Timbre = 0;
    } else {
      if (body.trspHeure !== undefined) patch.U_TrspHeur = (body.trspHeure ?? "").trim() || null;
      try {
        const timbre = await getTransporteurTimbre(code);
        if (timbre != null) patch.U_Timbre = timbre;
      } catch (e) {
        console.warn(`[orders PATCH] Timbre SERGTRS '${code}' non résolu (non-bloquant):`, (e as Error).message);
      }
    }
  }
  // Changement de date de livraison depuis « Détail livraison ».
  if (typeof body.dueDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.dueDate)) patch.DocDueDate = body.dueDate;

  try {
    await sap.patch(`Orders(${params.docEntry})`, patch);
    // Mémorise (best-effort) la tournée choisie pour ce client → ré-appliquée
    // automatiquement aux prochaines commandes. "" = désaffecté → on oublie.
    if (ord?.cardCode && body.trspCode !== undefined) {
      const code = (body.trspCode ?? "").trim();
      try {
        await setClientTournee(ord.cardCode, code ? {
          trspCode: code,
          heure: (body.trspHeure ?? "").toString().trim() || null,
          nom: body.tournee?.nom ?? null,
          des: body.tournee?.des ?? null,
          lineId: body.tournee?.lineId ?? null,
        } : null);
      } catch (e) {
        console.warn(`[orders PATCH] Mémorisation tournée ${ord.cardCode} échouée (non-bloquant):`, (e as Error).message);
      }
    }
    const o = await sap.get<Order>(`Orders(${params.docEntry})`);

    // ── Report du n° de commande sur la/les FACTURE(S) liée(s) (BL clôturé) ──
    // Un BL clôturé a en général déjà été copié en facture : le n° client saisi
    // après coup (portail Auchan…) doit suivre sur la facture — c'est elle qui
    // porte la réf. chez le client. Une facture référence la commande par ses
    // lignes BaseType=17 (oOrders) + BaseEntry (même mécanique que la liste des
    // dernières commandes de la console). Best-effort : le n° est de toute
    // façon posé sur le BL ; les n° de factures mises à jour partent dans la
    // réponse pour enrichir le toast.
    const invoiceNums: number[] = [];
    if (body.numAtCard !== undefined && o.DocumentStatus === "bost_Close" && o.CardCode) {
      try {
        type Inv = { DocEntry: number; DocNum: number; DocumentLines?: { BaseType?: number; BaseEntry?: number }[] };
        const filter = encodeURIComponent(`CardCode eq '${o.CardCode.replace(/'/g, "''")}'`);
        const inv = await sap.get<{ value: Inv[] }>(
          `Invoices?$top=60&$orderby=DocEntry desc&$select=DocEntry,DocNum,DocumentLines&$filter=${filter}`,
        );
        const orderEntry = Number(params.docEntry);
        for (const f of inv.value || []) {
          if (!(f.DocumentLines || []).some((l) => l.BaseType === 17 && l.BaseEntry === orderEntry)) continue;
          await sap.patch(`Invoices(${f.DocEntry})`, { NumAtCard: patch.NumAtCard });
          invoiceNums.push(f.DocNum);
        }
      } catch (e) {
        console.warn(`[orders PATCH] Report NumAtCard sur facture (BL ${params.docEntry}) échoué (non-bloquant):`, (e as Error).message);
      }
    }

    return NextResponse.json({ ok: true, total: o.DocTotal ?? 0, totalHT: (o.DocTotal ?? 0) - (o.VatSum ?? 0), invoiceNums });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
