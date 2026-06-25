import { NextRequest, NextResponse } from "next/server";
import type { Session } from "next-auth";
import { auth } from "@/lib/auth";
import { getAccessScope, cardCodeInScope } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { sap } from "@/lib/sapb1";
import { getLotMaps, resolveLotDetailed, LOT_PENDING } from "@/lib/lotResolver";
import { chooseLot, unitInfo } from "@/lib/gervifrais-calc";

/**
 * Modification d'une commande SAP EXISTANTE et OUVERTE (même BL, jamais de
 * nouveau document) — pilotée depuis « Détail livraison » → Écran 2.
 *
 * GET  /api/sap/orders/[docEntry]/modif
 *   → les lignes du BL, prêtes à PRÉ-REMPLIR le panier de l'Écran 2 : une entrée
 *     par DocumentLine (mapping 1:1 avec le LineNum SAP, pas de regroupement),
 *     quantité reconvertie en colis/kg, prix unitaire, tags produit, dispo stock.
 *
 * POST /api/sap/orders/[docEntry]/modif
 *   Body : {
 *     updates?:   [{ lineNum, quantity, price? }],                 // lignes existantes (qté SAP)
 *     additions?: [{ itemCode, quantity, warehouseCode?, price?, discountPercent? }]  // nouvelles lignes
 *   }
 *   `quantity` est en unité de stock SAP (pie/kg) — conversion colis→stock faite côté front.
 *   - updates : modifie les lignes existantes par LineNum (Quantity/Price), même
 *     mécanisme que le PATCH d'édition déjà en prod.
 *   - additions : ajoute de nouvelles lignes (LineNum = max+1…), enrichies comme à
 *     la création (lot FIFO U_NoLot, U_GER_*, TPF INTERFEL/DDG par ligne).
 *   Les lignes existantes NON listées dans `updates` sont conservées telles quelles
 *   (le Service Layer fusionne par LineNum). Un seul PATCH → aucun 2ᵉ BL.
 *
 *   Réponse : { ok, docEntry, docNum, updatedLines, addedLines, totalHT, totalTTC }
 */

type SapLine = {
  LineNum: number; ItemCode: string; ItemDescription?: string; Quantity: number;
  Price?: number; WarehouseCode?: string; LineStatus?: string; U_NoLot?: string;
};
type SapOrder = {
  DocEntry: number; DocNum: number; CardCode: string; DocDueDate: string;
  DocumentStatus?: string; Cancelled?: string; Comments?: string; DocumentLines: SapLine[];
};
type SapExpense = { ExpensCode: number; Name: string; U_Taux: number; OutputVATGroup: string };

const WAREHOUSE_NAMES: Record<string, string> = { "000": "A/C - A/D", "01": "Stock", "R1": "J+1" };

/** Charge la commande SAP + garde-fous (auth, périmètre, ouverte). */
async function loadOrder(
  docEntry: number,
  session: Session,
): Promise<{ order: SapOrder } | { error: NextResponse }> {
  let order: SapOrder;
  try {
    order = await sap.get<SapOrder>(
      `Orders(${docEntry})?$select=DocEntry,DocNum,CardCode,DocDueDate,DocumentStatus,Cancelled,Comments,DocumentLines`,
    );
  } catch {
    return { error: NextResponse.json({ ok: false, error: `Commande ${docEntry} introuvable dans SAP.` }, { status: 404 }) };
  }
  const scope = await getAccessScope(session);
  if (!(await cardCodeInScope(scope, order.CardCode))) {
    return { error: NextResponse.json({ error: "Commande hors de votre périmètre" }, { status: 403 }) };
  }
  return { order };
}

export async function GET(_req: NextRequest, props: { params: Promise<{ docEntry: string }> }) {
  const { docEntry: docEntryStr } = await props.params;
  const docEntry = Number(docEntryStr);
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  if (!Number.isFinite(docEntry)) return NextResponse.json({ error: "docEntry invalide" }, { status: 400 });

  const loaded = await loadOrder(docEntry, session);
  if ("error" in loaded) return loaded.error;
  const { order } = loaded;

  const editable = order.DocumentStatus === "bost_Open" && order.Cancelled !== "tYES";

  // Référentiel produits (unité d'affichage, emballage, tags, stocks) pour
  // reconvertir chaque ligne SAP en ligne de panier éditable.
  const itemCodes = Array.from(new Set((order.DocumentLines || []).map((l) => l.ItemCode)));
  const prods = await prisma.product.findMany({
    where: { itemCode: { in: itemCodes } },
    select: {
      itemCode: true, itemName: true, salesUnit: true, salesQtyPerPackUnit: true,
      salesItemsPerUnit: true, salesUnitWeight: true,
      uMarque: true, uCondi: true, uPays: true, frgnName: true,
      stocks: { select: { warehouse: true, available: true } },
    },
  });
  const prodMap = new Map(prods.map((p) => [p.itemCode, p]));

  const cartLines = (order.DocumentLines || []).map((l) => {
    const p = prodMap.get(l.ItemCode);
    const info = unitInfo(p?.salesUnit, p?.salesQtyPerPackUnit, p?.salesItemsPerUnit ?? null, p?.salesUnitWeight);
    const { packDivisor, displayUnit, priceUnit } = info;

    const availByWarehouse: Record<string, number> = {};
    for (const w of ["000", "01", "R1"]) {
      const a = (p?.stocks.find((s) => s.warehouse === w)?.available ?? 0) / packDivisor;
      availByWarehouse[w] = Math.floor(a * 10) / 10;
    }

    // Incrément « un colis » dans l'unité d'affichage (miroir de addToCart côté front).
    let colisW = info.colisWeightKg ?? null;
    if ((colisW == null || colisW <= 0) && displayUnit === "kg") {
      const q = p?.salesQtyPerPackUnit && p.salesQtyPerPackUnit > 1 ? p.salesQtyPerPackUnit : 1;
      const w = p?.salesUnitWeight && p.salesUnitWeight > 0 ? p.salesUnitWeight : 1;
      colisW = Math.round(q * w * 1000) / 1000;
    }
    const stepColis = displayUnit === "kg" ? (colisW && colisW > 0 ? Math.round(colisW * 100) / 100 : 1) : 1;

    return {
      lineNum: l.LineNum,
      warehouse: l.WarehouseCode ?? null,
      lot: l.U_NoLot ?? null,                       // lot d'origine (préservé au remplacement)
      closed: l.LineStatus === "bost_Close",        // ligne déjà livrée → verrouillée
      itemCode: l.ItemCode,
      itemName: p?.itemName || l.ItemDescription || l.ItemCode,
      unit: displayUnit,
      priceUnit,
      packDivisor,
      availByWarehouse,
      quantity: Math.round((l.Quantity / packDivisor) * 100) / 100,   // → colis/kg (affichage)
      qtyPieces: l.Quantity,                                          // quantité SAP brute (renvoi sans drift)
      price: l.Price && l.Price > 0 ? l.Price : null,
      marque: p?.uMarque ?? null,
      condi: p?.uCondi ?? null,
      pays: p?.uPays ?? null,
      variete: (p?.frgnName ?? "").trim() || null,
      stepColis,
    };
  });

  return NextResponse.json({
    ok: true,
    docEntry: order.DocEntry,
    docNum: order.DocNum,
    dueDate: order.DocDueDate,
    editable,
    comments: order.Comments ?? "",
    cartLines,
  });
}

/**
 * Ligne FINALE envoyée par le front (ordre du tableau = ordre du BL) :
 *   - `keep` + `lot` : ligne conservée → on préserve son lot d'origine.
 *   - sinon : nouvelle ligne → lot résolu (FIFO) côté serveur.
 * `quantity` est en unité de stock SAP (pie/kg). Le découpe-entrepôt est déjà
 * fait côté front (une entrée par couple article×entrepôt).
 */
interface FinalLine {
  itemCode: string;
  quantity: number;
  warehouseCode?: string;
  price?: number;
  discountPercent?: number;
  keep?: boolean;
  lot?: string | null;
}

export async function POST(req: NextRequest, props: { params: Promise<{ docEntry: string }> }) {
  const { docEntry: docEntryStr } = await props.params;
  const docEntry = Number(docEntryStr);
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  if (!Number.isFinite(docEntry)) return NextResponse.json({ error: "docEntry invalide" }, { status: 400 });

  let body: { lines?: FinalLine[]; comments?: string };
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: "JSON invalide" }, { status: 400 }); }

  const lines = (body.lines ?? []).filter((l) => l.itemCode && l.quantity > 0);
  // SAP refuse un document sans ligne → on impose au moins une ligne.
  if (lines.length === 0) {
    return NextResponse.json({ error: "Un bon de livraison doit garder au moins une ligne." }, { status: 400 });
  }

  const loaded = await loadOrder(docEntry, session);
  if ("error" in loaded) return loaded.error;
  const { order } = loaded;

  if (order.Cancelled === "tYES" || order.DocumentStatus === "bost_Close") {
    return NextResponse.json(
      { ok: false, error: "Commande clôturée ou annulée — modification impossible. Créez une nouvelle commande." },
      { status: 409 },
    );
  }

  // ── Référentiels (pour U_GER_*, TPF, et lot des NOUVELLES lignes) ──
  const itemCodes = Array.from(new Set(lines.map((l) => l.itemCode)));
  const prods = await prisma.product.findMany({
    where: { itemCode: { in: itemCodes } },
    select: {
      itemCode: true, uPays: true, uMarque: true, uCondi: true,
      salesUnitWeight: true, salesQtyPerPackUnit: true,
    },
  });
  const productMap = new Map(prods.map((p) => [p.itemCode, p]));

  // Stock (signaux pour la décision de lot des nouvelles lignes uniquement).
  const sapStockByItem = new Map<string, number>();
  const availableByItem = new Map<string, number>();
  const needLot = lines.some((l) => !(l.keep && l.lot));
  if (needLot) {
    try {
      const filter = itemCodes.map((c) => `ItemCode eq '${c.replace(/'/g, "''")}'`).join(" or ");
      const r = await sap.get<{ value: { ItemCode: string; QuantityOnStock?: number }[] }>(
        `Items?$select=ItemCode,QuantityOnStock&$filter=${filter}`,
      );
      for (const it of r.value ?? []) if (typeof it.QuantityOnStock === "number") sapStockByItem.set(it.ItemCode, it.QuantityOnStock);
    } catch { /* SAP renverra l'erreur réelle au PATCH si un item est invalide */ }
    const stocks = await prisma.productStock.findMany({
      where: { product: { itemCode: { in: itemCodes } } },
      select: { available: true, product: { select: { itemCode: true } } },
    });
    for (const s of stocks) {
      const code = s.product.itemCode;
      availableByItem.set(code, (availableByItem.get(code) ?? 0) + s.available);
    }
  }
  const lotMaps = needLot ? await getLotMaps() : null;

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

  // ── Reconstruction COMPLÈTE des lignes (LineNum 0..N dans l'ordre reçu) ──
  let keptLines = 0, newLines = 0;
  const documentLines: Record<string, unknown>[] = lines.map((l, idx) => {
    const meta = productMap.get(l.itemCode);
    const line: Record<string, unknown> = {
      LineNum: idx,                 // séquentiel → fixe l'ordre des lignes du BL
      ItemCode: l.itemCode,
      Quantity: l.quantity,
    };
    if (l.warehouseCode) line.WarehouseCode = l.warehouseCode;
    const hasDiscount = typeof l.discountPercent === "number" && Number.isFinite(l.discountPercent) && l.discountPercent > 0;
    if (l.price != null && l.price > 0) {
      // On fixe TOUJOURS le prix unitaire (brut) saisi. Avec une remise, on NE fixe
      // PAS `Price` (le net) : sinon Price + UnitPrice + remise se contredisent et
      // SAP reprend le prix tarif. SAP calcule le net depuis UnitPrice × (1 − remise).
      line.UnitPrice = l.price;
      if (!hasDiscount) line.Price = l.price;
    }
    if (hasDiscount) line.DiscountPercent = Math.min(100, Math.max(0, l.discountPercent!));
    if (meta?.uPays) line.U_GER_Pays = meta.uPays;
    if (meta?.uMarque) line.U_GER_Marque = meta.uMarque;
    if (meta?.uCondi) line.U_GER_Condi = meta.uCondi;
    if (l.warehouseCode) line.U_NomMag = WAREHOUSE_NAMES[l.warehouseCode] ?? l.warehouseCode;

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

    // Lot : conservé tel quel pour une ligne existante, résolu (FIFO) pour une nouvelle.
    if (l.keep && l.lot) {
      keptLines++;
      line.U_NoLot = l.lot;
    } else {
      newLines++;
      const resolved = lotMaps ? resolveLotDetailed(lotMaps, l.itemCode, l.warehouseCode) : { lot: null };
      const choice = chooseLot({
        resolvedLot: resolved.lot,
        localAvailable: availableByItem.get(l.itemCode) ?? 0,
        sapOnHand: sapStockByItem.get(l.itemCode) ?? null,
        envDefault: process.env.GERVIFRAIS_LOT_DEFAUT ?? null,
      });
      line.U_NoLot = choice.lot || LOT_PENDING;
    }

    return line;
  });

  // ── PATCH SAP : remplacement COMPLET de la collection de lignes ──
  // B1S-ReplaceCollectionsOnPatch:true → SAP remplace toute la collection
  // DocumentLines par celle envoyée (au lieu de fusionner par LineNum). C'est le
  // SEUL moyen fiable de SUPPRIMER une ligne et de RÉORDONNER dans ce SAP — un
  // PATCH normal conserve les lignes omises. Le numéro de BL (DocNum) est préservé.
  // Note BL éditable (texte promo/divers) — écrite dans les commentaires du bon
  // uniquement si fournie (undefined = on n'y touche pas).
  const patchBody: Record<string, unknown> = { DocumentLines: documentLines };
  if (typeof body.comments === "string") patchBody.Comments = body.comments.slice(0, 254);

  try {
    await sap.patch(
      `Orders(${docEntry})`,
      patchBody,
      { headers: { "B1S-ReplaceCollectionsOnPatch": "true" } },
    );
    type Refetched = { DocTotal?: number; VatSum?: number };
    let refetched: Refetched | null = null;
    try { refetched = await sap.get<Refetched>(`Orders(${docEntry})?$select=DocTotal,VatSum`); }
    catch { /* non bloquant */ }

    return NextResponse.json({
      ok: true,
      docEntry,
      docNum: order.DocNum,
      totalLines: documentLines.length,
      keptLines,
      newLines,
      totalTTC: refetched?.DocTotal ?? null,
      totalHT: refetched ? (refetched.DocTotal ?? 0) - (refetched.VatSum ?? 0) : null,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error(`[Modif] PATCH Orders(${docEntry}) échoué:`, message);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
