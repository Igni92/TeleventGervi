import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { requireCanReceivePurchaseOrder } from "@/lib/permissions";
import { sap } from "@/lib/sapb1";
import { incrementLocalStock } from "@/lib/stockSync";
import { bumpLot, LOT_PENDING } from "@/lib/lotResolver";
import { creditLots, debitLots } from "@/lib/lotLedger";
import { buildWhsBudget, remainingForItem, pickReceiptWarehouse, consumeBudget } from "@/lib/receiptRetro";
import { applyAgreage, type AgreageStatus } from "@/lib/agreage";
import { setMarchandiseNote, sanitizeRating } from "@/lib/marchandiseNote";
import { setEmGroup } from "@/lib/emGroup";
import { docRef } from "@/lib/docLabel";
import { heureParis } from "@/lib/paris-time";

/**
 * POST /api/sap/purchase-orders/receive  { docEntry, agreage? }
 *
 * « Valider la réception » d'une COMMANDE FOURNISSEUR (PurchaseOrder) : crée les
 * bons de réception (PurchaseDeliveryNotes) à partir de la commande — chaque
 * ligne référence la ligne de la commande (BaseType=22) → SAP copie
 * quantités/prix et CLÔTURE la commande. La commande « passe » alors en entrée
 * marchandise.
 *
 * ⚠️ DÉCOUPAGE « UNE EM PAR LIGNE » (aligné sur /api/sap/goods-receipts) :
 * chaque ligne ouverte de la commande devient sa PROPRE PurchaseDeliveryNote
 * SAP, pour un lot / une DLC / une annulation PAR article. Les EM du groupe
 * partagent la même référence (« EM <n° de la 1re> … · réception CF <n°> ») ;
 * Télévente les regroupe en UNE entrée à l'affichage (lib/emGroup), avec le n°
 * d'EM propre à chaque ligne.
 *
 * AGRÉAGE (contrôle qualité à la réception, geste de l'agréeur) : le body porte
 * `agreage: { status: "CONFORME" | "RESERVE", type?, note? }`. L'agréage est
 * posé sur l'EM créée (lib/agreage) ; une RÉSERVE ouvre automatiquement un
 * incident de réception pour le suivi du litige fournisseur.
 *
 * Effets de bord (cohérents avec /api/sap/goods-receipts) :
 *   - lot « EM<DocNum> » posé sur chaque ligne du BR ;
 *   - cache des lots (bumpLot) + incrément optimiste du stock local (latence 0).
 */
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  // #7 — Valider la réception crée une entrée marchandise et incrémente le stock :
  // geste réservé à la préparation / l'administration OU à l'AGRÉEUR (son seul
  // droit : passer une commande fournisseur en entrée marchandise).
  if (!(await requireCanReceivePurchaseOrder(session))) return NextResponse.json({ error: "Réservé à la préparation / l'administration / l'agréeur" }, { status: 403 });

  let body: {
    docEntry?: number;
    agreage?: {
      status?: string; type?: string; note?: string;
      // Note qualité (étoiles) de l'agréeur : UNE note PAR PRODUIT (itemCode →
      // 1..5), chacune posée sur l'EM/lot de ce produit. `rating` (note unique
      // pour tous les articles) est conservé en repli pour compat.
      ratings?: Record<string, number>;
      rating?: number;
    };
  };
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: "JSON invalide" }, { status: 400 }); }

  const agreageStatus: AgreageStatus | null =
    body.agreage?.status === "CONFORME" || body.agreage?.status === "RESERVE"
      ? body.agreage.status
      : null;
  if (body.agreage && !agreageStatus) {
    return NextResponse.json({ error: "agreage.status invalide (CONFORME | RESERVE)" }, { status: 400 });
  }

  const poEntry = Number(body.docEntry);
  if (!poEntry || Number.isNaN(poEntry)) {
    return NextResponse.json({ error: "docEntry (commande) requis" }, { status: 400 });
  }

  // ── 1. Lecture de la commande fournisseur (lignes encore ouvertes) ──
  type PoLine = {
    LineNum: number; ItemCode: string; WarehouseCode?: string;
    RemainingOpenQuantity?: number; Quantity?: number; LineStatus?: string;
  };
  type Po = {
    DocEntry: number; DocNum: number; CardCode: string; CardName?: string;
    DocumentStatus?: string; DocumentLines: PoLine[];
  };
  let po: Po;
  try {
    po = await sap.get<Po>(
      `PurchaseOrders(${poEntry})?$select=DocEntry,DocNum,CardCode,CardName,DocumentStatus,DocumentLines`,
    );
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: `Commande fournisseur introuvable : ${e instanceof Error ? e.message : ""}` },
      { status: 404 },
    );
  }
  if (po.DocumentStatus === "bost_Close") {
    return NextResponse.json({ ok: false, error: "Commande déjà clôturée." }, { status: 409 });
  }

  // Lignes encore ouvertes uniquement (on ne re-réceptionne pas une ligne close).
  const openLines = (po.DocumentLines || []).filter((l) => l.LineStatus !== "bost_Close");
  if (openLines.length === 0) {
    return NextResponse.json({ ok: false, error: "Aucune ligne ouverte à réceptionner." }, { status: 409 });
  }

  // ── 2. PDN basés sur la commande — UNE EM PAR LIGNE OUVERTE (BaseType=22 →
  //    SAP copie qté/prix et clôture la ligne de la commande) ──
  const today = new Date().toISOString().slice(0, 10);
  const emHeure = heureParis();   // heure de réception (serveur, fuseau Paris)

  type SapPdn = { DocEntry: number; DocNum: number };
  type CreatedDoc = { docEntry: number; docNum: number; lot: string };
  const createdDocs: CreatedDoc[] = [];
  // N° du GROUPE = DocNum de la 1re EM créée (affiché par Télévente, gravé dans
  // la référence de chaque EM du groupe).
  let groupNum: number | null = null;
  let createError: string | null = null;

  for (const l of openLines) {
    const payload: Record<string, unknown> = {
      CardCode: po.CardCode,
      DocDate: today,
      DocDueDate: today,
      TaxDate: today,
      // Référence signée « EM <n° du groupe> - <initiales> à <heure> · réception
      // CF <n° CF> ». Pour la 1re EM le n° n'existe qu'après création →
      // provisoire ici, gravée plus bas ; les suivantes le portent d'emblée.
      Comments: docRef({ prefix: "EM", docNum: groupNum ?? undefined, name: session.user?.name, email: session.user?.email, heure: emHeure, note: `réception CF ${po.DocNum}` }),
      DocumentLines: [{
        BaseType: 22,            // 22 = PurchaseOrder
        BaseEntry: po.DocEntry,
        BaseLine: l.LineNum,
      }],
    };
    try {
      const created = await sap.post<SapPdn>("/PurchaseDeliveryNotes", payload);
      if (groupNum == null) groupNum = created.DocNum;
      createdDocs.push({ docEntry: created.DocEntry, docNum: created.DocNum, lot: `EM${created.DocNum}` });
    } catch (e) {
      // Échec en cours de route : les lignes déjà réceptionnées sont closes sur
      // la CF — les lignes restantes restent OUVERTES et se réceptionnent en
      // relançant la réception (le filtre LineStatus ne reprend que l'ouvert).
      createError = e instanceof Error ? e.message : String(e);
      console.error(`[POReceive] ❌ SAP CREATE FAILED (ligne ${l.LineNum} · ${l.ItemCode}):`, createError);
      break;
    }
  }

  if (createdDocs.length === 0) {
    return NextResponse.json({ ok: false, error: createError ?? "Création SAP échouée" }, { status: 500 });
  }

  // EM « primaire » du groupe (la 1re) : n° affiché + clé des champs historiques.
  const primary = createdDocs[0];
  const lotCode = primary.lot;
  const docNums = createdDocs.map((d) => d.docNum);
  const me = session.user?.name?.trim() || session.user?.email || "?";
  // Groupe persisté (AppSetting) : l'historique regroupe ces EM en une seule.
  if (createdDocs.length > 1) {
    try { await setEmGroup(primary.docNum, docNums); }
    catch (e) { console.warn("[POReceive] Enregistrement du groupe d'EM échoué (non-bloquant):", (e as Error).message); }
  }
  console.log("[POReceive] ✅", createdDocs.length, "EM créée(s) depuis la CF", po.DocNum, "| Groupe EM", primary.docNum, "| DocNums:", docNums.join(", "));

  // ── Agréage (contrôle qualité) posé sur l'EM PRIMAIRE du groupe (celle que
  //    l'historique affiche) — réserve → UN incident pour toute la réception ──
  let agreage: { status: AgreageStatus; type: string | null; note: string | null } | null = null;
  if (agreageStatus) {
    try {
      agreage = await applyAgreage({
        docEntry: primary.docEntry, docNum: primary.docNum, lot: lotCode,
        cardCode: po.CardCode, cardName: po.CardName ?? null,
        status: agreageStatus, type: body.agreage?.type, note: body.agreage?.note, by: me,
      });
    } catch (e) {
      console.warn("[POReceive] agréage non enregistré (non-bloquant):", (e as Error).message);
    }
  }

  // ── 3. Par EM : lot EM<DocNum propre> + référence gravée (n° du groupe) +
  //    refetch des lignes créées (qté/entrepôt pour le stock) ──
  type CreatedLine = { LineNum: number; ItemCode: string; Quantity: number; WarehouseCode?: string; Price?: number };
  const createdLines: (CreatedLine & { docNum: number; lot: string })[] = [];
  for (const d of createdDocs) {
    try {
      const refetch = await sap.get<{ DocumentLines: CreatedLine[] }>(
        `/PurchaseDeliveryNotes(${d.docEntry})?$select=DocumentLines`,
      );
      const lines = refetch.DocumentLines || [];
      createdLines.push(...lines.map((l) => ({ ...l, docNum: d.docNum, lot: d.lot })));
      const patchLines = lines.map((l) => ({ LineNum: l.LineNum, U_NoLot: d.lot }));
      const patchBody: Record<string, unknown> = {
        Comments: docRef({ prefix: "EM", docNum: primary.docNum, name: session.user?.name, email: session.user?.email, heure: emHeure, note: `réception CF ${po.DocNum}` }),
      };
      if (patchLines.length > 0) patchBody.DocumentLines = patchLines;
      await sap.patch(`PurchaseDeliveryNotes(${d.docEntry})`, patchBody);
    } catch (e) {
      console.warn(`[POReceive] PATCH U_NoLot / référence EM ${d.docNum} échoué (non-bloquant):`, (e as Error).message);
    }
  }

  // ── Note qualité (étoiles) de l'agréeur — UNE note PAR PRODUIT, posée sur
  //    l'EM/lot de ce produit (« une EM par ligne » → une note par EM). L'UI
  //    envoie `ratings` (itemCode → note) ; repli sur `rating` (note unique
  //    héritée, appliquée à tous les articles) pour compat. Best-effort. ──
  const ratingsByItem = body.agreage?.ratings && typeof body.agreage.ratings === "object" ? body.agreage.ratings : null;
  const flatRating = sanitizeRating(body.agreage?.rating);
  if (ratingsByItem || flatRating != null) {
    const seen = new Set<string>();
    await Promise.all(createdLines.filter((l) => l.ItemCode).map((l) => {
      const key = `${l.ItemCode}::${l.lot}`;
      if (seen.has(key)) return Promise.resolve();
      seen.add(key);
      const r = ratingsByItem ? sanitizeRating(ratingsByItem[l.ItemCode]) : flatRating;
      return r != null ? setMarchandiseNote(l.ItemCode, l.lot, r, me).catch(() => {}) : Promise.resolve();
    }));
  }

  // ── Registre des lots : CRÉDIT (réception via commande fournisseur) ──
  // Aligné sur /api/sap/goods-receipts : chaque lot EM<DocNum> naît ici (un par
  // ligne), on mémorise la quantité reçue + fournisseur + prix pour le décrément
  // à la vente. Best-effort.
  try {
    const admission = new Date(`${today}T12:00:00Z`);
    await creditLots(createdLines.map((l) => ({
      itemCode: l.ItemCode,
      lot: l.lot,
      qty: l.Quantity,
      supplierName: po.CardName?.trim() || po.CardCode,
      purchasePrice: l.Price ?? null,
      currency: "EUR",
      sourceDocNum: String(l.docNum),
      admissionDate: admission,
    })));
  } catch (e) {
    console.warn("[POReceive] Crédit registre lots échoué (non-bloquant):", (e as Error).message);
  }

  // ── 4. Cache lots + incrément stock local (latence 0) ──
  for (const l of createdLines) {
    if (l.WarehouseCode) bumpLot(l.ItemCode, l.WarehouseCode, l.docNum);
  }
  try {
    await incrementLocalStock(
      createdLines
        .filter((l) => l.WarehouseCode)
        .map((l) => ({ itemCode: l.ItemCode, quantity: l.Quantity, warehouseCode: l.WarehouseCode as string })),
    );
  } catch (e) {
    console.warn("[POReceive] incrementLocalStock échoué (non-bloquant):", (e as Error).message);
  }

  // ── 5. Propagation rétro : recoller les ventes / sorties fabrication à
  //    DÉCOUVERT à cette réception — MÊME logique que /api/sap/goods-receipts.
  //    Une commande vendue à découvert est parquée en magasin d'attente 000
  //    (« A/C - A/D ») avec le lot sentinel EM_PENDING. Quand la marchandise
  //    qui la couvre arrive — ICI, via la réception d'une commande fournisseur —
  //    on DÉPLACE la ligne vers le magasin de réception (01) et on lui pose le
  //    vrai lot EM<DocNum>. Sans ça, la ligne restait bloquée en 000 (jamais
  //    reliée au lot ni déplacée) : le magasin 000 restait négatif, le stock
  //    s'accumulait en 01, et l'article restait affiché « manquant ».
  //    Ce chemin (réception de commande fournisseur) ne le faisait PAS, contrairement
  //    à l'entrée marchandise libre — d'où le décalage constaté.
  //    Budget de couverture par (article × magasin), en unité d'inventaire (pie),
  //    construit à partir des lignes RÉELLEMENT créées côté SAP.
  const RETRO_WINDOW_DAYS = 60;
  const retroSince = new Date(Date.now() - RETRO_WINDOW_DAYS * 86_400_000).toISOString().slice(0, 10);
  const budget = buildWhsBudget(
    createdLines
      .filter((l) => l.WarehouseCode && (l.Quantity ?? 0) > 0)
      .map((l) => ({ itemCode: l.ItemCode, warehouseCode: l.WarehouseCode as string, pieceQty: l.Quantity })),
  );
  // Lot à poser par ARTICLE : avec « une EM par ligne », chaque article reçu a
  // SON propre lot (celui de la 1re EM du groupe qui le porte en cas de doublon).
  const lotByItem = new Map<string, string>();
  for (const l of createdLines) if (l.ItemCode && !lotByItem.has(l.ItemCode)) lotByItem.set(l.ItemCode, l.lot);

  // ── 5a. Commandes clients ouvertes à découvert (FIFO DocEntry asc) ──
  let retroPatchCount = 0;
  const retroDebits: { itemCode: string; lot: string; qty: number }[] = [];
  try {
    type SapOrderLine = { LineNum: number; ItemCode: string; Quantity: number; U_NoLot?: string; WarehouseCode?: string };
    type SapOrderForRetro = { DocEntry: number; DocNum: number; DocumentLines: SapOrderLine[] };
    const orders = await sap.getAll<SapOrderForRetro>(
      `Orders?$orderby=DocEntry asc`
      + `&$select=DocEntry,DocNum,DocumentLines`
      + `&$filter=${encodeURIComponent(`DocDate ge '${retroSince}' and DocumentStatus eq 'bost_Open'`)}`,
      { pageSize: 200 },
    );
    for (const ord of orders) {
      const patchLines: Record<string, unknown>[] = [];
      const orderDebits: { itemCode: string; lot: string; qty: number }[] = [];
      for (const ln of (ord.DocumentLines || [])) {
        if (ln.U_NoLot !== LOT_PENDING) continue;                 // ligne en attente de lot uniquement
        if (remainingForItem(budget, ln.ItemCode) <= 0) continue; // rien reçu pour cet article → skip
        const whs = pickReceiptWarehouse(budget, ln.ItemCode, ln.WarehouseCode);
        if (!whs) continue;
        const itemLot = lotByItem.get(ln.ItemCode) ?? lotCode;    // lot de l'article (une EM par ligne)
        const patch: Record<string, unknown> = { LineNum: ln.LineNum, U_NoLot: itemLot };
        if (whs !== ln.WarehouseCode) patch.WarehouseCode = whs;  // déplace 000 → magasin de réception
        patchLines.push(patch);
        orderDebits.push({ itemCode: ln.ItemCode, lot: itemLot, qty: ln.Quantity });
        consumeBudget(budget, ln.ItemCode, whs, ln.Quantity);
      }
      if (patchLines.length > 0) {
        await sap.patch(`Orders(${ord.DocEntry})`, { DocumentLines: patchLines });
        retroPatchCount += patchLines.length;
        retroDebits.push(...orderDebits);                          // débit registre APRÈS PATCH réussi
        console.log(`[POReceive] Retro lots du groupe EM ${primary.docNum} → Order #${ord.DocNum} (${patchLines.length} ligne(s))`);
      }
    }
    if (retroDebits.length > 0) {
      try { await debitLots(retroDebits); }
      catch (e) { console.warn("[POReceive] Débit registre rétro échoué (non-bloquant):", (e as Error).message); }
    }
    console.log(
      `[POReceive] Propagation rétro : ${orders.length} commande(s) ouverte(s) depuis le ${retroSince} scannée(s), `
      + `${retroPatchCount} ligne(s) ${LOT_PENDING} → lots du groupe EM ${primary.docNum}`,
    );
  } catch (e) {
    console.warn("[POReceive] Propagation rétro échouée (non-bloquant):", (e as Error).message);
  }

  // ── 5b. Sorties fabrication (InventoryGenExits) du jour à découvert — miroir
  //    de la retro Orders (composant fabriqué à découvert), même budget partagé.
  let retroFabricationCount = 0;
  const retroFabDebits: { itemCode: string; lot: string; qty: number }[] = [];
  try {
    type SapExitLine = { LineNum: number; ItemCode: string; Quantity: number; U_NoLot?: string; WarehouseCode?: string };
    type SapExitForRetro = { DocEntry: number; DocNum: number; DocumentLines: SapExitLine[] };
    const exits = await sap.getAll<SapExitForRetro>(
      `InventoryGenExits?$orderby=DocEntry asc`
      + `&$select=DocEntry,DocNum,DocumentLines`
      + `&$filter=${encodeURIComponent(`DocDate eq '${today}'`)}`,
      { pageSize: 200 },
    );
    const patchedItems = new Set<string>();
    for (const exit of exits) {
      const patchLines: Record<string, unknown>[] = [];
      const exitDebits: { itemCode: string; lot: string; qty: number }[] = [];
      for (const ln of (exit.DocumentLines || [])) {
        if (ln.U_NoLot !== LOT_PENDING) continue;
        if (remainingForItem(budget, ln.ItemCode) <= 0) continue;
        const whs = pickReceiptWarehouse(budget, ln.ItemCode, ln.WarehouseCode);
        if (!whs) continue;
        const itemLot = lotByItem.get(ln.ItemCode) ?? lotCode;
        const patch: Record<string, unknown> = { LineNum: ln.LineNum, U_NoLot: itemLot };
        if (whs !== ln.WarehouseCode) patch.WarehouseCode = whs;
        patchLines.push(patch);
        exitDebits.push({ itemCode: ln.ItemCode, lot: itemLot, qty: ln.Quantity });
        patchedItems.add(ln.ItemCode);
        consumeBudget(budget, ln.ItemCode, whs, ln.Quantity);
      }
      if (patchLines.length > 0) {
        await sap.patch(`InventoryGenExits(${exit.DocEntry})`, { DocumentLines: patchLines });
        retroFabricationCount += patchLines.length;
        retroFabDebits.push(...exitDebits);
        console.log(`[POReceive] Retro lots du groupe EM ${primary.docNum} → InventoryGenExit #${exit.DocNum} (${patchLines.length} ligne(s))`);
      }
    }
    if (retroFabDebits.length > 0) {
      try { await debitLots(retroFabDebits); }
      catch (e) { console.warn("[POReceive] Débit registre rétro fabrication échoué (non-bloquant):", (e as Error).message); }
    }
    // Miroir local : FabricationRunLine encore en sentinel sur les items patchés,
    // restreint aux runs du jour (on ne réécrit pas d'anciens runs jamais couverts).
    for (const itemCode of Array.from(patchedItems)) {
      const itemLot = lotByItem.get(itemCode) ?? lotCode;
      const updated = await prisma.$executeRawUnsafe(
        `UPDATE "FabricationRunLine" AS rl
            SET "batchNumber" = $1
           FROM "FabricationRun" AS r
          WHERE r."id" = rl."runId"
            AND rl."batchNumber" = $2
            AND rl."itemCode" = $3
            AND r."createdAt" >= CURRENT_DATE;`,
        itemLot, LOT_PENDING, itemCode,
      );
      if (updated > 0) {
        console.log(`[POReceive] FabricationRunLine ${itemCode}: ${updated} ligne(s) ${LOT_PENDING} → ${itemLot}`);
      }
    }
    console.log(
      `[POReceive] Propagation rétro fabrication : ${exits.length} sortie(s) du ${today} scannée(s), `
      + `${retroFabricationCount} ligne(s) ${LOT_PENDING} → lots du groupe EM ${primary.docNum}`,
    );
  } catch (e) {
    console.warn("[POReceive] Propagation rétro fabrication échouée (non-bloquant):", (e as Error).message);
  }

  return NextResponse.json({
    ok: true,
    // Champs « historiques » = EM primaire du groupe (n° affiché dans Télévente).
    docNum: primary.docNum,
    docEntry: primary.docEntry,
    lot: lotCode,
    // Groupe « une EM par ligne » : toutes les EM SAP réellement créées.
    docNums,
    docEntries: createdDocs.map((d) => d.docEntry),
    lots: createdDocs.map((d) => d.lot),
    emCount: createdDocs.length,
    // Échec PARTIEL : les lignes restées ouvertes sur la CF se réceptionnent en
    // relançant la réception (seules les lignes ouvertes sont reprises).
    partialError: createError ?? undefined,
    fromPoNum: po.DocNum,
    agreage,
    retroPatchedLines: retroPatchCount,          // BL ouverts à découvert repris sur les lots du groupe (déplacés 000 → 01)
    retroFabricationLines: retroFabricationCount, // sorties fabrication du jour reprises sur les lots du groupe
  });
}
