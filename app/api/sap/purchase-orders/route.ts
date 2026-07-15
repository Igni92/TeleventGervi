import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { docRef } from "@/lib/docLabel";
import { prisma } from "@/lib/prisma";
import { sap } from "@/lib/sapb1";
import { isAgreeur, requirePreparateurOrAdmin } from "@/lib/permissions";

const WHITELIST_WHS = new Set(["000", "01", "R1"]);

/**
 * POST /api/sap/purchase-orders — crée une COMMANDE FOURNISSEUR (PurchaseOrder).
 *
 * Body : { cardCode, dueDate (ISO/yyyy-mm-dd), numAtCard?, comment?,
 *          lines: [{ itemCode, packageQuantity (colis), warehouseCode, price? }] }
 *
 * Comme l'entrée marchandise : la saisie est en COLIS, on envoie Quantity (pie)
 * ET PackageQuantity (colis). Pas d'effet stock (c'est un engagement d'achat).
 */
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  // L'AGRÉEUR ne peut PAS créer de commande fournisseur (son seul droit est de
  // « passer » une commande existante en entrée marchandise). On bloque donc un
  // agréeur qui n'a pas par ailleurs un rôle de gestion (préparateur / admin /
  // direction, qui eux gardent le droit de création).
  if (!(await requirePreparateurOrAdmin(session)) && (await isAgreeur(session))) {
    return NextResponse.json({ error: "L'agréeur ne peut pas créer de commande fournisseur." }, { status: 403 });
  }

  let body: {
    cardCode?: string; dueDate?: string; orderTime?: string; numAtCard?: string; comment?: string;
    lines?: { itemCode: string; packageQuantity: number; warehouseCode: string; price?: number }[];
  };
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: "JSON invalide" }, { status: 400 }); }

  if (!body.cardCode?.trim()) return NextResponse.json({ error: "Fournisseur requis" }, { status: 400 });
  if (!Array.isArray(body.lines) || body.lines.length === 0) {
    return NextResponse.json({ error: "Au moins 1 ligne requise" }, { status: 400 });
  }
  for (const l of body.lines) {
    if (!l.itemCode || !l.packageQuantity || l.packageQuantity <= 0) {
      return NextResponse.json({ error: `Ligne invalide : ${JSON.stringify(l)}` }, { status: 400 });
    }
    if (!l.warehouseCode || !WHITELIST_WHS.has(l.warehouseCode)) {
      return NextResponse.json({ error: `Entrepôt invalide : ${l.warehouseCode}` }, { status: 400 });
    }
  }
  const cardCode = body.cardCode.trim();
  const today = new Date().toISOString().slice(0, 10);
  const due = body.dueDate ? new Date(body.dueDate).toISOString().slice(0, 10) : today;
  // Heure de prise de commande « HH:MM » : SAP DocDate est sans heure → reportée
  // dans les Comments (« … · Commande à 09h15 »), visible sur la CF et l'historique.
  const orderTime = (body.orderTime && /^([01]\d|2[0-3]):[0-5]\d$/.test(body.orderTime)) ? body.orderTime : null;

  // Ratio colis → pie depuis le catalogue local.
  const codes = Array.from(new Set(body.lines.map((l) => l.itemCode)));
  const products = await prisma.product.findMany({
    where: { itemCode: { in: codes } },
    select: { itemCode: true, salesQtyPerPackUnit: true },
  });
  const ratioOf = new Map(products.map((p) => [p.itemCode, (p.salesQtyPerPackUnit && p.salesQtyPerPackUnit > 1) ? p.salesQtyPerPackUnit : 1]));

  const DocumentLines = body.lines.map((l) => {
    const ratio = ratioOf.get(l.itemCode) ?? 1;
    const line: Record<string, unknown> = {
      ItemCode: l.itemCode,
      Quantity: l.packageQuantity * ratio,
      PackageQuantity: l.packageQuantity,
      WarehouseCode: l.warehouseCode,
    };
    if (l.price != null && l.price > 0) { line.UnitPrice = l.price; line.Price = l.price; }
    return line;
  });

  const heure = orderTime ? orderTime.replace(":", "h") : null;
  const note = body.comment?.trim() || null;
  const payload: Record<string, unknown> = {
    CardCode: cardCode,
    DocDate: today,
    DocDueDate: due,
    TaxDate: today,
    // Référence signée « CF <n°> - <initiales> à <heure> ». Le n° de CF n'existe
    // qu'après création → référence provisoire (sans n°) ici, patchée avec le
    // DocNum juste après le POST ci-dessous.
    Comments: docRef({ prefix: "CF", name: session.user?.name, email: session.user?.email, heure, note }),
    DocumentLines,
  };
  if (body.numAtCard?.trim()) payload.NumAtCard = body.numAtCard.trim();

  try {
    const created = await sap.post<{ DocEntry: number; DocNum: number }>("/PurchaseOrders", payload);
    // Grave le n° définitif dans la référence : « CF <DocNum> - <initiales> à <heure> ».
    try {
      await sap.patch(`PurchaseOrders(${created.DocEntry})`, {
        Comments: docRef({ prefix: "CF", docNum: created.DocNum, name: session.user?.name, email: session.user?.email, heure, note }),
      });
    } catch (e) {
      console.warn("[PurchaseOrder] PATCH référence CF échoué (non-bloquant):", e instanceof Error ? e.message : String(e));
    }
    return NextResponse.json({ ok: true, docNum: created.DocNum, docEntry: created.DocEntry });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error("[PurchaseOrder] CREATE FAILED:", message);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

/**
 * GET /api/sap/purchase-orders?last=30
 *
 * Liste les dernières COMMANDES FOURNISSEURS (SAP B1 `PurchaseOrders`).
 * Lecture seule — consultation à côté des Entrées marchandises sur /entrees.
 *
 * Une commande fournisseur précède l'entrée marchandise : c'est l'engagement
 * d'achat. On affiche le statut (Ouverte / Clôturée), la date de commande, la
 * date de livraison prévue (DocDueDate), le fournisseur et le détail des lignes.
 */
export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

  // L'AGRÉEUR « pur » (sans rôle de gestion) ne doit PAS voir les PRIX des
  // commandes fournisseurs : il ne fait que passer la commande en entrée
  // marchandise. On masque donc les montants côté serveur (défense en
  // profondeur — l'UI les cache aussi) : prix de ligne, total ligne et totaux
  // document renvoyés à 0/null. La préparation / l'administration voit tout.
  const priceBlind = (await isAgreeur(session)) && !(await requirePreparateurOrAdmin(session));

  const { searchParams } = new URL(req.url);
  const last = Math.min(50, parseInt(searchParams.get("last") || "30"));

  try {
    type ListedLine = {
      ItemCode: string; ItemDescription?: string;
      Quantity: number; PackageQuantity?: number;
      WarehouseCode?: string;
      Price?: number;
      LineTotal?: number;
      TaxPercentagePerRow?: number;
      LineStatus?: string;            // bost_Open | bost_Close
    };
    type SapPoListed = {
      DocEntry: number; DocNum: number; DocDate: string; DocDueDate?: string;
      CardCode: string; CardName?: string; NumAtCard?: string;
      DocTotal?: number; VatSum?: number; Comments?: string;
      DocumentStatus?: string;        // bost_Open | bost_Close
      Cancelled?: string;             // tYES | tNO — commande annulée
      DocumentLines?: ListedLine[];
    };
    const docs = await sap.get<{ value: SapPoListed[] }>(
      `PurchaseOrders?$top=${last}&$orderby=DocEntry desc`
      + `&$select=DocEntry,DocNum,DocDate,DocDueDate,CardCode,CardName,NumAtCard,DocTotal,VatSum,Comments,DocumentStatus,Cancelled,DocumentLines`,
    );

    // Enrichissement local : désignation complète (Fruit/Pays/Marque/Condt) +
    // ratio colis pour reconstituer la quantité « type condt » dans le détail.
    const itemCodes = Array.from(
      new Set((docs.value || []).flatMap((d) => (d.DocumentLines || []).map((l) => l.ItemCode))),
    );
    const products = itemCodes.length
      ? await prisma.product.findMany({
          where: { itemCode: { in: itemCodes } },
          select: {
            itemCode: true, itemName: true, salesQtyPerPackUnit: true, salesPackagingUnit: true,
            uPays: true, uMarque: true, uCondi: true, frgnName: true,
          },
        })
      : [];
    const pMap = new Map(products.map((p) => [p.itemCode, p]));

    return NextResponse.json({
      db: process.env.SAP_B1_COMPANY_DB,
      count: docs.value?.length || 0,
      docs: (docs.value || []).map((d) => {
        const lines = d.DocumentLines || [];
        const totalTTC = d.DocTotal ?? 0;
        const totalTVA = d.VatSum ?? 0;
        const sumLines = lines.reduce((s, l) => s + (l.LineTotal ?? 0), 0);
        const totalHT = sumLines > 0 ? sumLines : Math.max(0, totalTTC - totalTVA);
        const cancelled = d.Cancelled === "tYES";
        return {
          docEntry: d.DocEntry,
          docNum: d.DocNum,
          docDate: d.DocDate,
          dueDate: d.DocDueDate ?? null,
          cardCode: d.CardCode,
          cardName: d.CardName,
          numAtCard: d.NumAtCard ?? "",
          // Une commande annulée est clôturée dans SAP (bost_Close) mais n'a jamais
          // été réceptionnée : on ne la considère pas « ouverte » (pas d'actions).
          open: d.DocumentStatus !== "bost_Close",   // Ouverte tant que non clôturée
          cancelled,                                 // Annulée (≠ réceptionnée)
          total: priceBlind ? 0 : totalTTC,
          totalTTC: priceBlind ? 0 : totalTTC,
          totalHT: priceBlind ? 0 : totalHT,
          totalTVA: priceBlind ? 0 : totalTVA,
          comments: d.Comments ?? "",
          lineCount: lines.length,
          lines: lines.map((l) => {
            const p = pMap.get(l.ItemCode);
            const ratio = (p?.salesQtyPerPackUnit && p.salesQtyPerPackUnit > 1) ? p.salesQtyPerPackUnit : 1;
            return {
              itemCode: l.ItemCode,
              itemName: l.ItemDescription || p?.itemName || l.ItemCode,
              pieceQuantity: l.Quantity,
              packageQuantity: l.PackageQuantity ?? (ratio > 1 ? l.Quantity / ratio : l.Quantity),
              warehouse: l.WarehouseCode,
              price: priceBlind ? null : (l.Price ?? null),
              lineTotal: priceBlind ? null : (l.LineTotal ?? null),
              taxPercent: priceBlind ? null : (l.TaxPercentagePerRow ?? null),
              open: l.LineStatus !== "bost_Close",
              uPays: p?.uPays ?? null,
              uMarque: p?.uMarque ?? null,
              uCondi: p?.uCondi ?? null,
              frgnName: p?.frgnName ?? null,
            };
          }),
        };
      }),
    });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
