import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getAccessScope, cardCodeInScope } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { sap } from "@/lib/sapb1";
import { getLotMaps, resolveLotDetailed, LOT_PENDING } from "@/lib/lotResolver";
import { chooseLot } from "@/lib/gervifrais-calc";

/**
 * POST /api/sap/orders/[docEntry]/rajout
 *
 * « Rajout » — ajoute des lignes à une commande SAP EXISTANTE et OUVERTE (même
 * BL), sans toucher aux lignes déjà présentes. Le Service Layer fusionne les
 * DocumentLines par LineNum : on n'envoie QUE les nouvelles lignes (LineNum =
 * max existant + 1, +2…), les lignes existantes sont conservées telles quelles
 * (même mécanisme que le PATCH d'édition de lignes, déjà en prod).
 *
 * Chaque ligne ajoutée est enrichie exactement comme à la création
 * (POST /api/sap/orders) : numéro de lot FIFO (U_NoLot, invariant : jamais de
 * ligne sans lot), champs U_GER_* (pays/marque/condi), et frais para-fiscaux
 * par ligne (TPF2 INTERFEL + TPF3 DDG) quand un prix est saisi.
 *
 * Body (même contrat de ligne que POST /api/sap/orders) :
 *   { lines: [{ itemCode, quantity, warehouseCode?, price?, discountPercent? }] }
 *   `quantity` est déjà en unité de stock SAP (pie/kg) — conversion colis→stock
 *   faite côté front, comme pour la création.
 *
 * Réponse : { ok, docEntry, docNum, addedLines, totalHT, totalTTC }
 */

interface RajoutLine {
  itemCode: string;
  quantity: number;
  warehouseCode?: string;
  price?: number;
  discountPercent?: number;
}

type SapExpense = { ExpensCode: number; Name: string; U_Taux: number; OutputVATGroup: string };

const WAREHOUSE_NAMES: Record<string, string> = { "000": "A/C - A/D", "01": "Stock", "R1": "J+1" };

export async function POST(req: NextRequest, props: { params: Promise<{ docEntry: string }> }) {
  const { docEntry: docEntryStr } = await props.params;
  const docEntry = Number(docEntryStr);
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  if (!Number.isFinite(docEntry)) return NextResponse.json({ error: "docEntry invalide" }, { status: 400 });

  let body: { lines?: RajoutLine[] };
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: "JSON invalide" }, { status: 400 }); }

  const lines = (body.lines ?? []).filter((l) => l.itemCode && l.quantity > 0);
  if (lines.length === 0) return NextResponse.json({ error: "Au moins 1 ligne requise" }, { status: 400 });

  // ── 1. Charger la commande existante : statut + cardCode + lignes actuelles ──
  type ExistingLine = { LineNum: number; ItemCode: string };
  type ExistingOrder = {
    DocEntry: number; DocNum: number; CardCode: string; DocDueDate: string;
    DocumentStatus?: string; Cancelled?: string; DocumentLines: ExistingLine[];
  };
  let order: ExistingOrder;
  try {
    order = await sap.get<ExistingOrder>(
      `Orders(${docEntry})?$select=DocEntry,DocNum,CardCode,DocDueDate,DocumentStatus,Cancelled,DocumentLines`,
    );
  } catch {
    return NextResponse.json({ ok: false, error: `Commande ${docEntry} introuvable dans SAP.` }, { status: 404 });
  }

  const scope = await getAccessScope(session);
  if (!(await cardCodeInScope(scope, order.CardCode))) {
    return NextResponse.json({ error: "Commande hors de votre périmètre" }, { status: 403 });
  }
  if (order.Cancelled === "tYES" || order.DocumentStatus === "bost_Close") {
    return NextResponse.json(
      { ok: false, error: "Commande clôturée ou annulée — rajout impossible. Créez une nouvelle commande." },
      { status: 409 },
    );
  }

  const existingLineNums = (order.DocumentLines || []).map((l) => l.LineNum);
  let nextLineNum = existingLineNums.length ? Math.max(...existingLineNums) + 1 : 0;

  // ── 2. Référentiels : produits (U_*, poids, emballage) + lot + stocks + TPF ──
  const itemCodes = Array.from(new Set(lines.map((l) => l.itemCode)));
  const prods = await prisma.product.findMany({
    where: { itemCode: { in: itemCodes } },
    select: {
      itemCode: true, uPays: true, uMarque: true, uCondi: true,
      salesUnitWeight: true, salesQtyPerPackUnit: true,
    },
  });
  const productMap = new Map(prods.map((p) => [p.itemCode, p]));

  // Stock SAP réel (QuantityOnStock) pour la décision de lot (filet anti faux-négatif).
  const sapStockByItem = new Map<string, number>();
  try {
    const filter = itemCodes.map((c) => `ItemCode eq '${c.replace(/'/g, "''")}'`).join(" or ");
    const r = await sap.get<{ value: { ItemCode: string; QuantityOnStock?: number }[] }>(
      `Items?$select=ItemCode,QuantityOnStock&$filter=${filter}`,
    );
    for (const it of r.value ?? []) if (typeof it.QuantityOnStock === "number") sapStockByItem.set(it.ItemCode, it.QuantityOnStock);
  } catch { /* SAP renverra l'erreur réelle au PATCH si un item est invalide */ }

  // Stock local agrégé (miroir) — second signal pour la décision de lot.
  const availableByItem = new Map<string, number>();
  const stocks = await prisma.productStock.findMany({
    where: { product: { itemCode: { in: itemCodes } } },
    select: { available: true, product: { select: { itemCode: true } } },
  });
  for (const s of stocks) {
    const code = s.product.itemCode;
    availableByItem.set(code, (availableByItem.get(code) ?? 0) + s.available);
  }

  const lotMaps = await getLotMaps();

  // Référentiel AdditionalExpenses (TPF2 INTERFEL=2, TPF3 DDG=3) — taux à jour de SAP.
  const TPF_AUTO = (process.env.GERVIFRAIS_AUTO_TAX ?? "true") !== "false";
  const expenses = new Map<number, SapExpense>();
  if (TPF_AUTO) {
    try {
      const r = await sap.get<{ value: SapExpense[] }>("AdditionalExpenses?$top=50");
      for (const e of r.value || []) expenses.set(e.ExpensCode, e);
    } catch { /* TPF best-effort */ }
  }
  const itfelMaster = expenses.get(2);
  const ddgMaster = expenses.get(3);

  // ── 3. Construire les nouvelles lignes (miroir POST /api/sap/orders) ──
  const documentLines: Record<string, unknown>[] = [];
  for (const l of lines) {
    const meta = productMap.get(l.itemCode);
    const line: Record<string, unknown> = {
      LineNum: nextLineNum++,
      ItemCode: l.itemCode,
      Quantity: l.quantity,
    };
    if (l.warehouseCode) line.WarehouseCode = l.warehouseCode;
    if (l.price != null && l.price > 0) { line.UnitPrice = l.price; line.Price = l.price; }
    if (typeof l.discountPercent === "number" && Number.isFinite(l.discountPercent) && l.discountPercent > 0) {
      line.DiscountPercent = Math.min(100, Math.max(0, l.discountPercent));
    }
    if (meta?.uPays) line.U_GER_Pays = meta.uPays;
    if (meta?.uMarque) line.U_GER_Marque = meta.uMarque;
    if (meta?.uCondi) line.U_GER_Condi = meta.uCondi;
    if (l.warehouseCode) line.U_NomMag = WAREHOUSE_NAMES[l.warehouseCode] ?? l.warehouseCode;

    // TPF par ligne (mêmes formules que la création), calculées sur le prix saisi.
    if (TPF_AUTO) {
      const lineHT = (l.price ?? 0) > 0 ? l.price! * l.quantity : 0;
      const packDiv = meta?.salesQtyPerPackUnit && meta.salesQtyPerPackUnit > 1 ? meta.salesQtyPerPackUnit : 1;
      const nbColis = l.quantity / packDiv;
      const lineExpenses: Record<string, unknown>[] = [];
      const itfelAmt = itfelMaster && lineHT > 0 ? Math.round(lineHT * ((itfelMaster.U_Taux || 0.21) / 100) * 100) / 100 : 0;
      const ddgAmt = ddgMaster && nbColis > 0 ? Math.round(nbColis * (ddgMaster.U_Taux || 0.02) * 100) / 100 : 0;
      if (itfelAmt > 0) lineExpenses.push({ GroupCode: 1, ExpenseCode: 2, LineTotal: itfelAmt });
      if (ddgAmt > 0) lineExpenses.push({ GroupCode: 2, ExpenseCode: 3, LineTotal: ddgAmt });
      if (lineExpenses.length > 0) line.DocumentLineAdditionalExpenses = lineExpenses;
    }

    // Numéro de lot — invariant : chaque ligne en a un (FIFO ou sentinel à découvert).
    const resolved = resolveLotDetailed(lotMaps, l.itemCode, l.warehouseCode);
    const choice = chooseLot({
      resolvedLot: resolved.lot,
      localAvailable: availableByItem.get(l.itemCode) ?? 0,
      sapOnHand: sapStockByItem.get(l.itemCode) ?? null,
      envDefault: process.env.GERVIFRAIS_LOT_DEFAUT ?? null,
    });
    line.U_NoLot = choice.lot || LOT_PENDING;

    documentLines.push(line);
  }

  // ── 4. PATCH SAP : fusion par LineNum → ajoute uniquement les nouvelles lignes ──
  try {
    await sap.patch(`Orders(${docEntry})`, { DocumentLines: documentLines });
    type Refetched = { DocNum: number; DocTotal?: number; VatSum?: number; DocumentLines?: { LineNum: number }[] };
    let refetched: Refetched | null = null;
    try { refetched = await sap.get<Refetched>(`Orders(${docEntry})?$select=DocNum,DocTotal,VatSum,DocumentLines`); }
    catch { /* non bloquant */ }

    return NextResponse.json({
      ok: true,
      docEntry,
      docNum: order.DocNum,
      addedLines: documentLines.length,
      totalTTC: refetched?.DocTotal ?? null,
      totalHT: refetched ? (refetched.DocTotal ?? 0) - (refetched.VatSum ?? 0) : null,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error(`[Rajout] PATCH Orders(${docEntry}) échoué:`, message);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
