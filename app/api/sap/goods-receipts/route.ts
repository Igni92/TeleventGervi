import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { docLabel } from "@/lib/docLabel";
import { prisma } from "@/lib/prisma";
import { sap } from "@/lib/sapb1";
import { isAgreeur, requirePreparateurOrAdmin } from "@/lib/permissions";
import { incrementLocalStock } from "@/lib/stockSync";
import { bumpLot, LOT_PENDING } from "@/lib/lotResolver";
import { buildWhsBudget, remainingForItem, pickReceiptWarehouse, consumeBudget } from "@/lib/receiptRetro";
import { normalizeEmAffect, setEmAffect } from "@/lib/emAffect";
import { creditLots } from "@/lib/lotLedger";

/**
 * POST /api/sap/goods-receipts
 *
 * Crée une ENTRÉE MARCHANDISE (PurchaseDeliveryNote) dans SAP B1,
 * façon Goods Receipt — entrée libre (sans PO), multi-entrepôts par ligne.
 *
 * Body :
 *   {
 *     cardCode:   string,                  // CardCode SAP du fournisseur
 *     numAtCard?: string,                  // n° BL fournisseur (NumAtCard)
 *     comment?:   string,                  // commentaire libre (Comments)
 *     lines: [
 *       { itemCode: string, packageQuantity: number,    // ⚠️ NOMBRE DE COLIS (pas de pie)
 *         warehouseCode: "000"|"01"|"R1", price?: number },
 *       ...
 *     ]
 *   }
 *
 * ⚠️ Convention quantité : l'UI saisit en **colis** (= unité physique reçue).
 * Le serveur :
 *   - envoie `PackageQuantity` (colis) ET `Quantity` (pie = colis × salesQtyPerPackUnit)
 *     dans le payload SAP. SAP B1 n'accepte pas seulement PackageQuantity : sans
 *     `Quantity` calculée, le champ "Qty Totale" reste = colis et le stock est faux
 *     (cf. BR test #22757 où 50 colis sont apparus comme 50 pie / 6.25 kg).
 *   - incrémente le ProductStock local en pie (cohérent avec la base SAP).
 *   - `price` reste le **prix unitaire en pie** (comme pour les Orders).
 *
 * Side effects (en cascade) :
 *   1. POST /PurchaseDeliveryNotes → crée le BR côté SAP, on récupère le DocNum.
 *   2. PATCH chaque ligne du BR avec U_NoLot = "EM<DocNum>" (cohérent avec le
 *      résolveur de lots utilisé par /api/sap/orders).
 *   3. bumpLot(itemCode, warehouseCode, DocNum) → injecte le lot frais dans le
 *      cache du résolveur pour que les Orders SUIVANTES utilisent ce lot sans
 *      attendre l'expiration TTL.
 *   4. incrementLocalStock(lines) → ProductStock.inStock/available += qty, latence 0.
 *
 * Réponse : { ok, docNum, docEntry, lot, cardCode, db, lines }
 */

const WHITELIST_WHS = new Set(["000", "01", "R1"]);

interface InLine {
  itemCode: string;
  packageQuantity: number;     // nb de colis (= unité physique reçue)
  warehouseCode: string;
  price?: number;
}
interface CreateBody {
  cardCode: string;
  docDate?: string;       // date de réception (défaut : aujourd'hui)
  numAtCard?: string;
  comment?: string;
  /** Affectation de l'EM à un segment client — « TOUS » (défaut), « EXPORT »,
   *  « GMS » ou « CHR ». Une EM affectée réserve son lot au segment (choix du
   *  lot à la saisie télévente) et sert ses commandes en PREMIER lors de la
   *  propagation rétro ci-dessous. Cf. lib/emAffect. */
  affect?: string;
  lines: InLine[];
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  // L'AGRÉEUR ne peut PAS créer d'entrée marchandise (son seul droit est de
  // « passer » une commande fournisseur existante en entrée marchandise via
  // /purchase-orders/receive). On bloque donc un agréeur qui n'a pas par ailleurs
  // un rôle de gestion (préparateur / admin / direction).
  if (!(await requirePreparateurOrAdmin(session)) && (await isAgreeur(session))) {
    return NextResponse.json({ error: "L'agréeur ne peut pas créer d'entrée marchandise." }, { status: 403 });
  }

  let body: CreateBody;
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: "JSON invalide" }, { status: 400 }); }

  // ── Validation ─────────────────────────────────────────
  if (!body.cardCode?.trim()) {
    return NextResponse.json({ error: "cardCode (fournisseur) requis" }, { status: 400 });
  }
  if (!Array.isArray(body.lines) || body.lines.length === 0) {
    return NextResponse.json({ error: "Au moins 1 ligne requise" }, { status: 400 });
  }
  for (const l of body.lines) {
    if (!l.itemCode || !l.packageQuantity || l.packageQuantity <= 0) {
      return NextResponse.json({ error: `Ligne invalide : ${JSON.stringify(l)}` }, { status: 400 });
    }
    if (!l.warehouseCode || !WHITELIST_WHS.has(l.warehouseCode)) {
      return NextResponse.json({
        error: `Entrepôt invalide sur ligne ${l.itemCode} : "${l.warehouseCode}". Attendu : 000, 01 ou R1.`,
      }, { status: 400 });
    }
  }
  const cardCode = body.cardCode.trim();

  // ── Récupère le ratio colis→pie depuis le catalogue local ──
  // Pour FRAMB12PD (barquettes de 125g, 12 par colis) : salesQtyPerPackUnit=12
  // donc 50 colis → Quantity=600 pie envoyée à SAP.
  const itemCodes = Array.from(new Set(body.lines.map((l) => l.itemCode)));
  const products = await prisma.product.findMany({
    where: { itemCode: { in: itemCodes } },
    select: { itemCode: true, salesQtyPerPackUnit: true, salesPackagingUnit: true, salesUnit: true },
  });
  const productMap = new Map(products.map((p) => [p.itemCode, p]));

  // ── Pré-validation : fournisseur existe (et n'est pas gelé) ──
  type SapBp = { CardCode: string; CardName?: string; CardType?: string; Frozen?: string; Valid?: string };
  let bp: SapBp;
  try {
    bp = await sap.get<SapBp>(
      `BusinessPartners('${encodeURIComponent(cardCode)}')?$select=CardCode,CardName,CardType,Frozen,Valid`,
    );
  } catch {
    return NextResponse.json({
      ok: false,
      error: `Fournisseur "${cardCode}" inexistant dans SAP "${process.env.SAP_B1_COMPANY_DB}".`,
    }, { status: 400 });
  }
  if (bp.Frozen === "tYES" || bp.Valid === "tNO") {
    return NextResponse.json({
      ok: false,
      error: `Fournisseur "${cardCode}" gelé ou invalide dans SAP. Entrée impossible.`,
    }, { status: 409 });
  }

  // ── Pré-validation : tous les items existent ──
  try {
    const uniqueCodes = Array.from(new Set(body.lines.map((l) => l.itemCode)));
    // Existence des articles en 1 requête (paquets de 40, parallèles) au lieu
    // d'un appel par article (N+1). Un article absent du résultat = inexistant.
    const VALIDATE_CHUNK = 40;
    const chunks: string[][] = [];
    for (let i = 0; i < uniqueCodes.length; i += VALIDATE_CHUNK) {
      chunks.push(uniqueCodes.slice(i, i + VALIDATE_CHUNK));
    }
    const found = new Set<string>();
    const results = await Promise.all(
      chunks.map((chunk) => {
        const filter = chunk.map((c) => `ItemCode eq '${c.replace(/'/g, "''")}'`).join(" or ");
        return sap.get<{ value: { ItemCode: string }[] }>(`Items?$select=ItemCode&$filter=${filter}`);
      }),
    );
    for (const res of results) for (const it of res.value ?? []) found.add(it.ItemCode);
    const missing = uniqueCodes.filter((c) => !found.has(c));
    if (missing.length > 0) {
      return NextResponse.json({
        ok: false,
        error: `Articles inexistants dans SAP "${process.env.SAP_B1_COMPANY_DB}" : ${missing.join(", ")}.`,
        missingItems: missing,
      }, { status: 400 });
    }
  } catch (e) {
    console.warn("[GoodsReceipt] Pré-validation items échouée:", (e as Error).message);
  }

  // ── Build SAP payload (PurchaseDeliveryNotes) ──
  // On envoie PackageQuantity (colis) ET Quantity (pie) — sans le calcul côté
  // serveur, SAP laisse Qty Totale = colis et le stock physique est faux.
  const today = new Date().toISOString().slice(0, 10);
  // Date du DOCUMENT (réception) : saisie au formulaire ou aujourd'hui. Distincte
  // de `today` (jour réel) qui sert aux scans de propagation rétro ci-dessous.
  const docDate = (body.docDate && /^\d{4}-\d{2}-\d{2}$/.test(body.docDate)) ? body.docDate : today;
  const resolvedLines = body.lines.map((l) => {
    const meta = productMap.get(l.itemCode);
    const ratio = (meta?.salesQtyPerPackUnit && meta.salesQtyPerPackUnit > 1) ? meta.salesQtyPerPackUnit : 1;
    const pieceQty = l.packageQuantity * ratio;
    return { ...l, pieceQty, ratio };
  });
  const documentLines = resolvedLines.map((l) => {
    const line: Record<string, unknown> = {
      ItemCode: l.itemCode,
      Quantity: l.pieceQty,                 // SAP "Qty Totale" en unité d'inventaire (pie)
      PackageQuantity: l.packageQuantity,   // SAP "Mbre" colis — visible sur le BR
      WarehouseCode: l.warehouseCode,
    };
    if (l.price != null && l.price > 0) {
      line.UnitPrice = l.price;
      line.Price = l.price;
    }
    return line;
  });
  const payload: Record<string, unknown> = {
    CardCode: cardCode,
    DocDate: docDate,
    DocDueDate: docDate,
    TaxDate: docDate,
    Comments: body.comment?.trim()
      || docLabel("EM", session.user?.name, session.user?.email),
    DocumentLines: documentLines,
  };
  if (body.numAtCard?.trim()) payload.NumAtCard = body.numAtCard.trim();

  // ── POST SAP /PurchaseDeliveryNotes ──
  console.log("[GoodsReceipt] → POST SAP/PurchaseDeliveryNotes — DB:", process.env.SAP_B1_COMPANY_DB);
  console.log("[GoodsReceipt]   Fournisseur:", cardCode, "| Lignes:", body.lines.length);

  type SapPdn = { DocEntry: number; DocNum: number; DocTotal?: number };
  let created: SapPdn;
  try {
    created = await sap.post<SapPdn>("/PurchaseDeliveryNotes", payload);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error("[GoodsReceipt] ❌ SAP CREATE FAILED:", message);
    return NextResponse.json(
      { ok: false, error: message, payload: process.env.NODE_ENV === "development" ? payload : undefined },
      { status: 500 },
    );
  }

  const lotCode = `EM${created.DocNum}`;
  console.log("[GoodsReceipt] ✅ SUCCESS — DocNum:", created.DocNum, "| Lot:", lotCode);

  // ── PATCH U_NoLot=EM<DocNum> sur chaque ligne ──
  // (le DocNum n'existe qu'après création — d'où le 2-temps).
  try {
    type CreatedLine = { LineNum: number };
    const refetch = await sap.get<{ DocumentLines: CreatedLine[] }>(
      `/PurchaseDeliveryNotes(${created.DocEntry})?$select=DocumentLines`,
    );
    const patchLines = (refetch.DocumentLines || []).map((l) => ({
      LineNum: l.LineNum,
      U_NoLot: lotCode,
    }));
    if (patchLines.length > 0) {
      await sap.patch(`PurchaseDeliveryNotes(${created.DocEntry})`, { DocumentLines: patchLines });
    }
  } catch (e) {
    console.warn("[GoodsReceipt] PATCH U_NoLot échoué (non-bloquant):", (e as Error).message);
  }

  // ── Cache des lots : injection immédiate pour les Orders qui suivent ──
  for (const l of body.lines) bumpLot(l.itemCode, l.warehouseCode, created.DocNum);

  // ── REGISTRE DES LOTS : CRÉDIT (réception) ──────────────────────────
  // Le lot EM<DocNum> naît ici : on mémorise la quantité reçue (pie), le
  // fournisseur et le prix d'achat. Le stock par lot est ensuite décrémenté à la
  // vente (cf. /api/sap/orders). Agrégé tous entrepôts (warehouseCode=""), en
  // unité SAP (pie) — cohérent avec la décrémentation. Best-effort.
  try {
    const admission = new Date(`${docDate}T12:00:00Z`);
    await creditLots(resolvedLines.map((l) => ({
      itemCode: l.itemCode,
      lot: lotCode,
      qty: l.pieceQty,
      supplierName: bp.CardName?.trim() || cardCode,
      purchasePrice: l.price ?? null,
      currency: "EUR",
      sourceDocNum: String(created.DocNum),
      admissionDate: admission,
    })));
  } catch (e) {
    console.warn("[GoodsReceipt] Crédit registre lots échoué (non-bloquant):", (e as Error).message);
  }

  // ── Affectation de l'EM (Tous/Export/GMS/CHR) — persistée par DocNum. Pilote
  //    le choix du lot à la saisie télévente (resolveLotForSegment) et la
  //    priorité de la propagation rétro ci-dessous. Best-effort. ──
  const affect = normalizeEmAffect(body.affect);
  try {
    await setEmAffect(created.DocNum, affect);
  } catch (e) {
    console.warn("[GoodsReceipt] Affectation EM non enregistrée (non-bloquant):", (e as Error).message);
  }

  // ── Propagation rétro : patcher les BL ouverts du jour qui portent LOT_PENDING
  //    sur un item présent dans ce PDN. FIFO par DocEntry asc, dans la limite de
  //    la quantité reçue pour cet item.
  //    ⚠️ Pas de lambda OData (`DocumentLines/any(l: ...)`) : ce Service Layer le
  //    rejette en HTTP 400 « Invalid symbol in the filter condition » (vérifié
  //    sonde 6a de scripts/diag-carriers.mjs, base GERVIFRAIS). On scanne donc
  //    les commandes ouvertes du jour (dates quotées, DocumentLines dans le
  //    $select — pas de $expand sur cette base) et on filtre les items côté
  //    serveur.
  //    Best-effort : on log mais on ne casse pas la création du PDN si ça échoue.

  // Budget de couverture par (article × MAGASIN), en pie. Sert à la fois à savoir
  // s'il reste de quoi couvrir un découvert ET à choisir le MAGASIN à affecter à
  // la ligne : le lot EM déplace la ligne vers le magasin où la marchandise a été
  // RÉELLEMENT reçue (sinon la ligne reste sur un magasin sans stock → dispo
  // négatif). Budget PARTAGÉ entre propagation BL (Orders, servis d'abord) et
  // fabrication (InventoryGenExits) : la marchandise reçue couvre les deux.
  const budget = buildWhsBudget(resolvedLines.map((l) => ({
    itemCode: l.itemCode, warehouseCode: l.warehouseCode, pieceQty: l.pieceQty,
  })));

  let retroPatchCount = 0;
  try {
    type SapOrderLine = {
      LineNum: number; ItemCode: string; Quantity: number; U_NoLot?: string; WarehouseCode?: string;
    };
    type SapOrderForRetro = {
      DocEntry: number; DocNum: number; DocDate: string; DocumentStatus: string;
      CardCode?: string;
      DocumentLines: SapOrderLine[];
    };

    // Scan paginé des commandes ouvertes du jour. getAll pose le header
    // `Prefer: odata.maxpagesize` — sans lui, le SL plafonne à 20 docs/page
    // (PageSize de b1s.conf) quel que soit $top.
    const orders = await sap.getAll<SapOrderForRetro>(
      `Orders?$orderby=DocEntry asc`
      + `&$select=DocEntry,DocNum,DocDate,DocumentStatus,CardCode,DocumentLines`
      + `&$filter=${encodeURIComponent(`DocDate eq '${today}' and DocumentStatus eq 'bost_Open'`)}`,
      { pageSize: 200 },
    );

    // ── EM AFFECTÉE à un segment : ses commandes sont servies EN PREMIER (l'achat
    //    de dernière minute a été fait pour elles — ex. export), le reste ensuite,
    //    à chaque fois en FIFO DocEntry. Segment client = Client.type, avec repli
    //    ClientDeliveryMode.sapCardCode → type du client parent (adresses de
    //    livraison). Best-effort : en cas d'échec, FIFO historique. ──
    if (affect !== "TOUS" && orders.length > 0) {
      try {
        const cc = [...new Set(orders.map((o) => o.CardCode).filter(Boolean))] as string[];
        const typeByCard = new Map<string, string>();
        if (cc.length) {
          const clients = await prisma.client.findMany({
            where: { code: { in: cc } },
            select: { code: true, type: true },
          });
          for (const c of clients) if (c.type) typeByCard.set(c.code, c.type.trim().toUpperCase());
          const modes = await prisma.clientDeliveryMode.findMany({
            where: { sapCardCode: { in: cc } },
            select: { sapCardCode: true, client: { select: { type: true } } },
          });
          for (const mo of modes) {
            if (mo.client?.type && !typeByCard.has(mo.sapCardCode)) {
              typeByCard.set(mo.sapCardCode, mo.client.type.trim().toUpperCase());
            }
          }
        }
        orders.sort((a, b) => {
          const pa = typeByCard.get(a.CardCode ?? "") === affect ? 0 : 1;
          const pb = typeByCard.get(b.CardCode ?? "") === affect ? 0 : 1;
          return pa - pb || a.DocEntry - b.DocEntry;
        });
        console.log(`[GoodsReceipt] EM affectée ${affect} → commandes ${affect} servies en premier.`);
      } catch (e) {
        console.warn("[GoodsReceipt] Priorisation segment échouée (non-bloquant):", (e as Error).message);
      }
    }

    for (const ord of orders) {
      const patchLines: Record<string, unknown>[] = [];
      for (const ln of (ord.DocumentLines || [])) {
        // Filtrage côté serveur : ligne en attente de lot ET item présent dans
        // ce PDN (reliquat = 0 pour les items hors PDN → skip).
        if (ln.U_NoLot !== LOT_PENDING) continue;
        if (remainingForItem(budget, ln.ItemCode) <= 0) continue;
        // Magasin de la réception à affecter : le lot DÉPLACE la ligne vers le
        // magasin où la marchandise a été reçue (évite le dispo négatif sur le
        // magasin d'origine, sans stock). On garde le magasin courant s'il a reçu.
        const whs = pickReceiptWarehouse(budget, ln.ItemCode, ln.WarehouseCode);
        if (!whs) continue;
        // FIFO simple : on accepte le BL si on a au moins la qté demandée, sinon
        // on patch quand même (le BL ne sera couvert que partiellement, mais lot
        // affecté) — TODO : split ligne si on veut être strict.
        const patch: Record<string, unknown> = { LineNum: ln.LineNum, U_NoLot: lotCode };
        if (whs !== ln.WarehouseCode) patch.WarehouseCode = whs;
        patchLines.push(patch);
        consumeBudget(budget, ln.ItemCode, whs, ln.Quantity);
      }
      if (patchLines.length > 0) {
        await sap.patch(`Orders(${ord.DocEntry})`, { DocumentLines: patchLines });
        retroPatchCount += patchLines.length;
        console.log(`[GoodsReceipt] Retro lot ${lotCode} → Order #${ord.DocNum} (${patchLines.length} ligne(s))`);
      }
    }
    console.log(
      `[GoodsReceipt] Propagation rétro : ${orders.length} commande(s) ouverte(s) du ${today} scannée(s), `
      + `${retroPatchCount} ligne(s) ${LOT_PENDING} → ${lotCode}`,
    );
  } catch (e) {
    console.warn("[GoodsReceipt] Propagation rétro échouée (non-bloquant):", (e as Error).message);
  }

  // ── Propagation rétro fabrication : sorties composants (InventoryGenExits) du
  //    jour en LOT_PENDING sur un item de ce PDN — composant fabriqué à découvert
  //    (cf. /api/sap/assembly v2). Même mécanique que les Orders : scan paginé du
  //    jour (pas de lambda, DocumentLines dans le $select, date quotée), budget
  //    quantités partagé, FIFO par DocEntry asc, best-effort.
  //    En miroir, les "FabricationRunLine" locales encore en sentinel sur les
  //    items patchés sont mises à jour (runs du jour uniquement).
  let retroFabricationCount = 0;
  try {
    type SapExitLine = {
      LineNum: number; ItemCode: string; Quantity: number; U_NoLot?: string; WarehouseCode?: string;
    };
    type SapExitForRetro = {
      DocEntry: number; DocNum: number; DocumentLines: SapExitLine[];
    };

    const exits = await sap.getAll<SapExitForRetro>(
      `InventoryGenExits?$orderby=DocEntry asc`
      + `&$select=DocEntry,DocNum,DocumentLines`
      + `&$filter=${encodeURIComponent(`DocDate eq '${today}'`)}`,
      { pageSize: 200 },
    );

    const patchedItems = new Set<string>();
    for (const exit of exits) {
      const patchLines: Record<string, unknown>[] = [];
      for (const ln of (exit.DocumentLines || [])) {
        if (ln.U_NoLot !== LOT_PENDING) continue;
        if (remainingForItem(budget, ln.ItemCode) <= 0) continue;
        const whs = pickReceiptWarehouse(budget, ln.ItemCode, ln.WarehouseCode);
        if (!whs) continue;
        const patch: Record<string, unknown> = { LineNum: ln.LineNum, U_NoLot: lotCode };
        if (whs !== ln.WarehouseCode) patch.WarehouseCode = whs;
        patchLines.push(patch);
        patchedItems.add(ln.ItemCode);
        consumeBudget(budget, ln.ItemCode, whs, ln.Quantity);
      }
      if (patchLines.length > 0) {
        await sap.patch(`InventoryGenExits(${exit.DocEntry})`, { DocumentLines: patchLines });
        retroFabricationCount += patchLines.length;
        console.log(`[GoodsReceipt] Retro lot ${lotCode} → InventoryGenExit #${exit.DocNum} (${patchLines.length} ligne(s))`);
      }
    }

    // Miroir local : FabricationRunLine encore en sentinel sur les items patchés
    // côté SAP, restreint aux runs du jour ("createdAt" >= minuit) — on ne
    // réécrit pas d'anciens runs jamais couverts par une EM.
    for (const itemCode of Array.from(patchedItems)) {
      const updated = await prisma.$executeRawUnsafe(
        `UPDATE "FabricationRunLine" AS rl
            SET "batchNumber" = $1
           FROM "FabricationRun" AS r
          WHERE r."id" = rl."runId"
            AND rl."batchNumber" = $2
            AND rl."itemCode" = $3
            AND r."createdAt" >= CURRENT_DATE;`,
        lotCode, LOT_PENDING, itemCode,
      );
      if (updated > 0) {
        console.log(`[GoodsReceipt] FabricationRunLine ${itemCode}: ${updated} ligne(s) ${LOT_PENDING} → ${lotCode}`);
      }
    }

    console.log(
      `[GoodsReceipt] Propagation rétro fabrication : ${exits.length} sortie(s) du ${today} scannée(s), `
      + `${retroFabricationCount} ligne(s) ${LOT_PENDING} → ${lotCode}`,
    );
  } catch (e) {
    console.warn("[GoodsReceipt] Propagation rétro fabrication échouée (non-bloquant):", (e as Error).message);
  }

  // ── Incrément optimiste local — latence 0 pour le commercial ──
  // ProductStock est en unité d'inventaire (pie), donc on incrémente pieceQty
  // (= colis × ratio), pas packageQuantity.
  try {
    await incrementLocalStock(resolvedLines.map((l) => ({
      itemCode: l.itemCode,
      quantity: l.pieceQty,
      warehouseCode: l.warehouseCode,
    })));
  } catch (e) {
    console.warn("[GoodsReceipt] incrementLocalStock échoué (non-bloquant):", (e as Error).message);
  }

  return NextResponse.json({
    ok: true,
    docNum: created.DocNum,
    docEntry: created.DocEntry,
    lot: lotCode,
    retroPatchedLines: retroPatchCount,        // BL ouverts du jour repris en EM<DocNum>
    retroFabricationLines: retroFabricationCount, // sorties fabrication du jour reprises en EM<DocNum>
    cardCode,
    db: process.env.SAP_B1_COMPANY_DB,
    lines: resolvedLines.map((l) => ({
      itemCode: l.itemCode,
      packageQuantity: l.packageQuantity,
      pieceQuantity: l.pieceQty,
      ratio: l.ratio,
      warehouse: l.warehouseCode,
      lot: lotCode,
    })),
  });
}

/**
 * GET /api/sap/goods-receipts?last=20
 *
 * Liste les dernières entrées marchandise (PurchaseDeliveryNotes) côté SAP.
 * Utile pour l'historique sur la page /entrees.
 */
export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const last = Math.min(50, parseInt(searchParams.get("last") || "20"));

  try {
    type ListedLine = {
      LineNum: number;                // n° de ligne SAP (pour l'édition de prix)
      ItemCode: string; ItemDescription?: string;
      Quantity: number; PackageQuantity?: number;
      WarehouseCode?: string;
      Price?: number;                 // prix unitaire HT (unité de stock)
      LineTotal?: number;             // total ligne HT
      TaxPercentagePerRow?: number;   // taux TVA de la ligne
      LineStatus?: string;            // bost_Open | bost_Close (ligne facturée)
      BaseType?: number;              // type du document de base (20 = réception → doc d'annulation)
      BaseEntry?: number;             // DocEntry du document de base
    };
    type SapPdnListed = {
      DocEntry: number; DocNum: number; DocDate: string; CardCode: string; CardName?: string;
      NumAtCard?: string; DocTotal?: number; VatSum?: number; Comments?: string;
      DocumentStatus?: string; Cancelled?: string; DocumentLines?: ListedLine[];
    };
    const docs = await sap.get<{ value: SapPdnListed[] }>(
      `PurchaseDeliveryNotes?$top=${last}&$orderby=DocEntry desc`
      + `&$select=DocEntry,DocNum,DocDate,CardCode,CardName,NumAtCard,DocTotal,VatSum,Comments,DocumentStatus,Cancelled,DocumentLines`,
    );

    // ── Détection des ANNULATIONS ───────────────────────────────
    // SAP « Annuler » crée un document d'annulation (une PurchaseDeliveryNote qui
    // INVERSE la réception) : ses lignes pointent la réception d'origine via
    // BaseType = 20 (oPurchaseDeliveryNotes). La réception d'origine, elle, porte
    // Cancelled = tYES. On relie les deux pour pouvoir les marquer dans l'UI.
    const PDN_OBJTYPE = 20;
    const listed = docs.value || [];
    const byEntry = new Map(listed.map((d) => [d.DocEntry, d]));
    const cancelBaseEntryOf = (d: SapPdnListed): number | null => {
      for (const l of d.DocumentLines || []) {
        if (Number(l.BaseType) === PDN_OBJTYPE && l.BaseEntry != null) return l.BaseEntry;
      }
      return null;
    };
    // DocEntry de la réception annulée → document d'annulation qui la référence.
    const cancellationByBaseEntry = new Map<number, SapPdnListed>();
    for (const d of listed) {
      const be = cancelBaseEntryOf(d);
      if (be != null) cancellationByBaseEntry.set(be, d);
    }

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
      count: listed.length,
      docs: listed.map((d) => {
        const lines = d.DocumentLines || [];
        const totalTTC = d.DocTotal ?? 0;
        const totalTVA = d.VatSum ?? 0;
        const sumLines = lines.reduce((s, l) => s + (l.LineTotal ?? 0), 0);
        const totalHT = sumLines > 0 ? sumLines : Math.max(0, totalTTC - totalTVA);
        // Statut annulation : ce doc EST une annulation (BaseType 20) ou A ÉTÉ annulé.
        const cancelBaseEntry = cancelBaseEntryOf(d);
        const isCancellation = cancelBaseEntry != null;
        const cancelsDocNum = isCancellation ? (byEntry.get(cancelBaseEntry as number)?.DocNum ?? null) : null;
        const cancellationDoc = cancellationByBaseEntry.get(d.DocEntry);
        const cancelled = !isCancellation && (d.Cancelled === "tYES" || cancellationDoc != null);
        const cancelledByDocNum = cancellationDoc?.DocNum ?? null;
        return {
          docEntry: d.DocEntry,
          docNum: d.DocNum,
          lot: `EM${d.DocNum}`,
          docDate: d.DocDate,
          cardCode: d.CardCode,
          cardName: d.CardName,
          numAtCard: d.NumAtCard ?? "",
          // Annulations : un doc d'annulation ou une réception annulée n'est plus
          // un vrai stock entré → ni prix éditable, ni action (annuler/retour).
          isCancellation,
          cancelsDocNum,
          cancelled,
          cancelledByDocNum,
          // Éditable (prix) tant que l'EM n'est pas clôturée (facture A/P créée) ni annulée.
          editable: d.DocumentStatus !== "bost_Close" && !isCancellation && !cancelled,
          total: totalTTC,        // rétro-compat : « total » = TTC
          totalTTC,
          totalHT,
          totalTVA,
          comments: d.Comments ?? "",
          lineCount: lines.length,
          lines: lines.map((l) => {
            const p = pMap.get(l.ItemCode);
            const ratio = (p?.salesQtyPerPackUnit && p.salesQtyPerPackUnit > 1) ? p.salesQtyPerPackUnit : 1;
            return {
              lineNum: l.LineNum,
              itemCode: l.ItemCode,
              itemName: l.ItemDescription || p?.itemName || l.ItemCode,
              pieceQuantity: l.Quantity,
              packageQuantity: l.PackageQuantity ?? (ratio > 1 ? l.Quantity / ratio : l.Quantity),
              warehouse: l.WarehouseCode,
              price: l.Price ?? null,
              lineTotal: l.LineTotal ?? null,
              taxPercent: l.TaxPercentagePerRow ?? null,
              // Désignation décomposée (catalogue local)
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

/**
 * PATCH /api/sap/goods-receipts
 *
 * Met à jour le N° BL fournisseur (NumAtCard) d'une entrée marchandise existante
 * (PurchaseDeliveryNote). Permet de renseigner / corriger le n° de BL après coup,
 * depuis la consultation du détail.
 *
 * Body : { docEntry: number, numAtCard: string }
 */
export async function PATCH(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

  let body: { docEntry?: number; numAtCard?: string };
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: "JSON invalide" }, { status: 400 }); }

  const docEntry = Number(body.docEntry);
  if (!docEntry || Number.isNaN(docEntry)) {
    return NextResponse.json({ error: "docEntry requis" }, { status: 400 });
  }
  const numAtCard = (body.numAtCard ?? "").trim();

  try {
    await sap.patch(`PurchaseDeliveryNotes(${docEntry})`, { NumAtCard: numAtCard });
    return NextResponse.json({ ok: true, numAtCard });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
