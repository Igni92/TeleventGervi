import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { docLabel } from "@/lib/docLabel";
import { getAccessScope, clientInScope } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { getTrclDefaultCarrier, getTrclCarrierHeure } from "@/lib/clientCarriers";
import { getTransporteurTimbre } from "@/lib/transporteurs";
import { getClientTournee, setClientTournee } from "@/lib/clientTournee";
import { notifyAll } from "@/lib/push";
import { sap } from "@/lib/sapb1";
import { mirrorCreatedOrder } from "@/lib/sapMirror";
import { decrementLocalStock } from "@/lib/stockSync";
import { getLotMaps, resolveLotForSegment, LOT_PENDING } from "@/lib/lotResolver";
import { getEmAffects } from "@/lib/emAffect";
import { createBonPrep, markBonPrepTransformed } from "@/lib/bonPrep";
import { chooseLot } from "@/lib/gervifrais-calc";
import { colisInfo } from "@/lib/colis";
import { isPrecommande } from "@/lib/livraison";

/**
 * Cache module-level du référentiel AdditionalExpenses SAP.
 * Le champ-clé est ExpensCode (typo SAP : sans "e" entre s et C).
 * On le ré-interroge max 1× / 10 min.
 */
type SapExpense = {
  ExpensCode: number;             // ⚠️ Sans le "e" — typo SAP
  Name: string;                   // ex. "CTIFL", "INTERFEL", "DROIT DE GARDE"
  U_Taux: number;                 // taux Gervifrais (€/100kg ou autre, dépend du frais)
  OutputVATGroup: string;         // ex. "C3" (5,5%) ou "C4" (20%)
};
let expensesCache: { at: number; map: Map<number, SapExpense> } | null = null;
async function getExpensesMap(): Promise<Map<number, SapExpense>> {
  const TTL = 10 * 60 * 1000;
  if (expensesCache && Date.now() - expensesCache.at < TTL) return expensesCache.map;
  const map = new Map<number, SapExpense>();
  try {
    const r = await sap.get<{ value: SapExpense[] }>("AdditionalExpenses?$top=50");
    for (const e of (r.value || [])) map.set(e.ExpensCode, e);
    expensesCache = { at: Date.now(), map };
  } catch (err) {
    console.warn("[Order] AdditionalExpenses fetch failed (using last cache):", (err as Error).message);
    if (expensesCache) return expensesCache.map;
  }
  return map;
}

/**
 * POST /api/sap/orders
 *
 * Crée une COMMANDE CLIENT (Sales Order) dans SAP B1.
 * Le BL (Delivery Note) est généré ensuite côté SAP lors de l'expédition.
 *
 * Body identique à avant :
 *   {
 *     clientId: string,              // Client TeleVent
 *     deliveryModeId?: string,       // Mode de livraison choisi → définit CardCode SAP
 *     deliveryDate: string,          // ISO date → DocDueDate
 *     comment?: string,
 *     comments?: string,             // prioritaire sur comment → SAP Comments (mention promos)
 *     lines: [
 *       { itemCode: string, quantity: number, warehouseCode?: string, price?: number,
 *         discountPercent?: number },   // 0-100 (clampé) → DocumentLines[].DiscountPercent
 *       ...
 *     ]
 *   }
 *
 * Side effects:
 *   - POST /Orders vers SAP B1 (DB définie par SAP_B1_COMPANY_DB)
 *   - Log un AppelLog type=COMMANDE avec scheduledFor=deliveryDate
 *
 * Réponse: { ok, docNum, docEntry, totalAmount, cardCode, db }
 */

interface OrderLine {
  itemCode: string;
  quantity: number;             // déjà converti en unité de stock SAP (pie) côté front
  displayQuantity?: number;     // qté telle que tapée par l'user (en colis ex.) — pour log
  displayUnit?: string;
  warehouseCode?: string;
  price?: number;
  manageBatch?: boolean;        // si true, le serveur tente d'attacher un lot FIFO
  discountPercent?: number;     // remise % (0-100, clampée) → DocumentLines[].DiscountPercent
  /** Lot AFFECTÉ en amont (bon de préparation export) → U_NoLot posé tel quel,
   *  sans résolution automatique. */
  lot?: string;
  /** Ligne À DÉCOUVERT (découpe front splitByWarehouse) : quantité SANS stock,
   *  isolée sur sa propre ligne. Aucun lot EM n'est résolu — U_NoLot part en
   *  LOT_PENDING et /api/sap/goods-receipts posera le vrai lot + magasin à la
   *  réception. Sans ce flag, le stock agrégé de l'article (autres magasins)
   *  ferait poser un vrai lot sur une quantité qui n'existe pas. */
  decouvert?: boolean;
}
interface CreateOrderBody {
  clientId: string;
  deliveryModeId?: string;
  deliveryDate: string;
  comment?: string;
  comments?: string;            // prioritaire sur comment → SAP Comments (mention des promos)
  numAtCard?: string;           // N° de commande client → SAP NumAtCard
  confirmEncours?: boolean;     // true = forcer malgré encours dépassé
  /** « BL » (défaut, auto-lot) ou « COMMANDE » (bon de commande : AUCUN auto-lot,
   *  lots affectés à la main dans l'onglet Bons de commande). Une précommande
   *  (date au-delà du prochain jour livrable) force « COMMANDE » quel que soit ce champ. */
  docKind?: "BL" | "COMMANDE";
  /** Transformation d'un BON DE PRÉPARATION (export) : présent = créer le BL
   *  pour de vrai (lots posés par ligne) et marquer le bon transformé — le
   *  divert « client EXPORT → bon de préparation » est alors court-circuité. */
  bonPrepId?: string;
  // C11 — Transporteur. Soit l'id d'un Carrier en DB (résolu serveur), soit
  // directement la valeur U_TrspCode à pousser (option raccourci). Le champ
  // SAP cible est ORDR.U_TrspCode (confirmé par l'utilisateur).
  carrierId?: string;
  carrierCode?: string;
  // Choix EXPLICITE transporteur + tournée à la création (prioritaire sur le
  // défaut SERG_TRCL). trspHeure = heure de la tournée ("HH:MM:SS") → U_TrspHeur.
  trspCode?: string;
  trspHeure?: string;
  // Détails de la tournée choisie → mémorisés pour ce client au succès
  // (auto-remplissage des prochaines créations — miroir du PATCH [docEntry]).
  tournee?: { nom?: string | null; des?: string | null; lineId?: number | null };
  lines: OrderLine[];
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

  let body: CreateOrderBody;
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: "JSON invalide" }, { status: 400 }); }

  // ── Validation ─────────────────────────────────────────
  if (!body.clientId) return NextResponse.json({ error: "clientId requis" }, { status: 400 });
  if (!body.deliveryDate) return NextResponse.json({ error: "deliveryDate requis" }, { status: 400 });
  if (!Array.isArray(body.lines) || body.lines.length === 0) {
    return NextResponse.json({ error: "Au moins 1 ligne requise" }, { status: 400 });
  }
  // ── #14 — Validation fine des lignes (avant tout appel SAP) ──
  // Rejet propre (400 + message FR) plutôt qu'un 500 SAP opaque sur :
  //   • quantité non finie (NaN/Infinity) ou ≤ 0
  //   • prix non fini (NaN/Infinity) ou < 0 (le prix 0 = tarif SAP, autorisé)
  for (const l of body.lines) {
    if (!l.itemCode) {
      return NextResponse.json({ error: `Ligne sans article (itemCode manquant).` }, { status: 400 });
    }
    if (!Number.isFinite(l.quantity) || l.quantity <= 0) {
      return NextResponse.json(
        { error: `Quantité invalide pour l'article ${l.itemCode} : elle doit être un nombre supérieur à 0.` },
        { status: 400 },
      );
    }
    if (l.price != null && (!Number.isFinite(l.price) || l.price < 0)) {
      return NextResponse.json(
        { error: `Prix invalide pour l'article ${l.itemCode} : il doit être un nombre positif ou nul.` },
        { status: 400 },
      );
    }
  }
  // ── #14 — Validation de la date de livraison (parseable + plage raisonnable) ──
  // On accepte d'hier (−1 j, tolérance fuseau/saisie de la veille au soir) jusqu'à
  // +1 an. Hors plage ou non parseable → 400 clair plutôt qu'un DocDueDate absurde
  // poussé dans SAP.
  {
    const due = new Date(body.deliveryDate);
    if (Number.isNaN(due.getTime())) {
      return NextResponse.json(
        { error: `Date de livraison illisible : « ${body.deliveryDate} ».` },
        { status: 400 },
      );
    }
    const now = Date.now();
    const minDate = now - 24 * 60 * 60 * 1000;            // hier
    const maxDate = now + 366 * 24 * 60 * 60 * 1000;      // +1 an
    if (due.getTime() < minDate) {
      return NextResponse.json(
        { error: `Date de livraison dans le passé. Choisis une date à partir d'aujourd'hui.` },
        { status: 400 },
      );
    }
    if (due.getTime() > maxDate) {
      return NextResponse.json(
        { error: `Date de livraison trop lointaine (plus d'un an). Vérifie la date saisie.` },
        { status: 400 },
      );
    }
  }

  const scope = await getAccessScope(session);
  if (!(await clientInScope(scope, body.clientId))) {
    return NextResponse.json({ error: "Client hors de votre périmètre" }, { status: 403 });
  }

  // ── 1. Resolve client + delivery mode → CardCode SAP ──
  const client = await prisma.client.findUnique({
    where: { id: body.clientId },
    select: { id: true, code: true, nom: true, type: true },
  });
  if (!client) return NextResponse.json({ error: "Client introuvable" }, { status: 404 });

  // Get cardCode from deliveryMode (or default mode, or client.code as fallback)
  let cardCode = client.code;
  if (body.deliveryModeId) {
    const mode = await prisma.$queryRawUnsafe<{ sapCardCode: string }[]>(
      `SELECT "sapCardCode" FROM "ClientDeliveryMode" WHERE id = $1 AND "clientId" = $2 LIMIT 1`,
      body.deliveryModeId, body.clientId,
    );
    if (mode[0]) cardCode = mode[0].sapCardCode;
  } else {
    // Try default mode
    const def = await prisma.$queryRawUnsafe<{ sapCardCode: string }[]>(
      `SELECT "sapCardCode" FROM "ClientDeliveryMode" WHERE "clientId" = $1 AND "isDefault" = true LIMIT 1`,
      body.clientId,
    );
    if (def[0]) cardCode = def[0].sapCardCode;
  }

  // ── CLIENT EXPORT → BON DE PRÉPARATION (hors SAP), pas de BL direct ───
  // Circuit export : marchandise achetée à la dernière minute, lots connus à la
  // réception. La saisie enregistre un bon de préparation (lib/bonPrep) ; les
  // lots y sont affectés à la main (panneau Détail livraison) puis le BL SAP est
  // créé « proprement » en repostant ici avec bonPrepId + lot par ligne.
  if ((client.type ?? "").trim().toUpperCase() === "EXPORT" && !body.bonPrepId) {
    try {
      // Noms d'articles pour l'affichage du panneau d'affectation (best-effort).
      const names = new Map<string, string>();
      try {
        const prods = await prisma.product.findMany({
          where: { itemCode: { in: body.lines.map((l) => l.itemCode) } },
          select: { itemCode: true, itemName: true },
        });
        for (const p of prods) names.set(p.itemCode, p.itemName);
      } catch { /* itemName = itemCode en repli */ }
      const bon = await createBonPrep({
        createdBy: session.user?.name?.trim() || session.user?.email || null,
        clientName: client.nom,
        cardCode,
        segment: "EXPORT",
        orderBody: {
          clientId: body.clientId,
          deliveryModeId: body.deliveryModeId,
          trspCode: body.trspCode,
          trspHeure: body.trspHeure,
          tournee: body.tournee,
          deliveryDate: body.deliveryDate,
          numAtCard: body.numAtCard,
          comments: body.comments ?? body.comment,
          lines: body.lines.map(({ manageBatch: _mb, ...rest }) => ({
            ...rest,
            itemName: names.get(rest.itemCode) ?? rest.itemCode,
          })),
        },
      });
      console.log(`[Order] Client EXPORT ${cardCode} → bon de préparation ${bon.id} (${body.lines.length} ligne(s)) — BL différé.`);
      return NextResponse.json({ ok: true, bonPrep: true, bonPrepId: bon.id, cardCode });
    } catch (e) {
      return NextResponse.json(
        { ok: false, error: `Échec de la création du bon de préparation : ${e instanceof Error ? e.message : String(e)}` },
        { status: 500 },
      );
    }
  }

  // ── 2. Build SAP Order payload — avec enrichissement U_* Gervifrais ───
  const today = new Date().toISOString().slice(0, 10);
  const dueDate = new Date(body.deliveryDate).toISOString().slice(0, 10);

  // Pré-fetch tous les Products correspondants pour les U_* + poids + emballage
  const itemCodes = body.lines.map((l) => l.itemCode);
  const productMap = new Map<string, {
    uPays: string | null; uMarque: string | null; uCondi: string | null;
    manageBatch: boolean; salesUnitWeight: number | null; itemGroup: number | null;
    salesQtyPerPackUnit: number | null;
  }>();
  if (itemCodes.length > 0) {
    const prods = await prisma.product.findMany({
      where: { itemCode: { in: itemCodes } },
      select: { itemCode: true, uPays: true, uMarque: true, uCondi: true, manageBatch: true,
               salesUnitWeight: true, itemGroup: true, salesQtyPerPackUnit: true },
    });
    prods.forEach((p) => productMap.set(p.itemCode, p));
  }

  // ── 2.1. Pré-validation SAP : items existants ? + VRAI stock SAP ──
  // (déplacée AVANT la construction des lignes : le même appel sert maintenant
  //  aussi de filet anti-faux-négatif pour le lot — cf. bug BL 24011560 où le
  //  miroir local disait 0 alors que les fraises du matin étaient réceptionnées.)
  // Empêche aussi le -2028 cryptique de SAP en retournant un message clair.
  const sapStockByItem = new Map<string, number>();
  try {
    const uniqueCodes = Array.from(new Set(body.lines.map((l) => l.itemCode)));
    // Validation existence + VRAI stock SAP en 1 requête (paquets de 40,
    // parallèles) au lieu d'un appel par article (N+1) → saisie de commande
    // bien plus rapide. Un article absent du résultat = inexistant dans SAP.
    const VALIDATE_CHUNK = 40;
    const chunks: string[][] = [];
    for (let i = 0; i < uniqueCodes.length; i += VALIDATE_CHUNK) {
      chunks.push(uniqueCodes.slice(i, i + VALIDATE_CHUNK));
    }
    const found = new Set<string>();
    const results = await Promise.all(
      chunks.map((chunk) => {
        const filter = chunk.map((c) => `ItemCode eq '${c.replace(/'/g, "''")}'`).join(" or ");
        return sap.get<{ value: { ItemCode: string; QuantityOnStock?: number }[] }>(
          `Items?$select=ItemCode,QuantityOnStock&$filter=${filter}`,
        );
      }),
    );
    for (const res of results) {
      for (const it of res.value ?? []) {
        found.add(it.ItemCode);
        if (typeof it.QuantityOnStock === "number") sapStockByItem.set(it.ItemCode, it.QuantityOnStock);
      }
    }
    const missing = uniqueCodes.filter((c) => !found.has(c));
    if (missing.length > 0) {
      const dbName = process.env.SAP_B1_COMPANY_DB;
      return NextResponse.json({
        ok: false,
        error: `Articles inexistants dans SAP "${dbName}" : ${missing.join(", ")}. Le catalogue TeleVent ne correspond peut-être pas à la DB courante — lance un re-sync sur /products.`,
        missingItems: missing,
      }, { status: 400 });
    }
  } catch (e) {
    console.warn("[Order] Pré-validation items échouée:", (e as Error).message);
    // On laisse passer — SAP renverra l'erreur réelle (et le lot retombera sur
    // le seul stock local, comme avant).
  }

  // Map des noms d'entrepôt humains
  const WAREHOUSE_NAMES: Record<string, string> = {
    "000": "A/C - A/D", "01": "Stock", "R1": "J+1",
  };

  // Fetch master AdditionalExpenses (cached) pour avoir U_Taux à jour de SAP
  const expensesMasterPreloaded = await getExpensesMap();
  const itfelMaster = expensesMasterPreloaded.get(2);    // INTERFEL → TPF2 ITFL
  const ddgMaster   = expensesMasterPreloaded.get(3);    // DROIT DE GARDE → TPF3 DDG
  const TPF_AUTO    = (process.env.GERVIFRAIS_AUTO_TAX ?? "true") !== "false";

  // Cartes des lots (EM<DocNum> des derniers bons de réception par item /
  // item+entrepôt) + AFFECTATIONS des EM (Tous/Export/GMS/CHR, cf. lib/emAffect) :
  // le lot d'une ligne est choisi PARMI les EM du segment du client — un BL GMS
  // ne prend jamais le lot d'un arrivage dédié export, et inversement.
  const lotMaps = await getLotMaps();
  const emAffects = await getEmAffects();
  const clientSegment = (client.type ?? "").trim().toUpperCase() || null;

  // Stock dispo agrégé par itemCode (miroir local — peut être en retard).
  // Combiné avec QuantityOnStock SAP (sapStockByItem, cf. 2.1) dans chooseLot() :
  // si AUCUN des deux n'est > 0 → vente à découvert → U_NoLot = LOT_PENDING
  // (réécrit par /api/sap/goods-receipts à la prochaine entrée marchandise).
  // Évite d'envoyer un faux EM<DocNum> pour un lot SAP déjà épuisé.
  const availableByItem = new Map<string, number>();
  if (itemCodes.length > 0) {
    const stocks = await prisma.productStock.findMany({
      where: { product: { itemCode: { in: itemCodes } } },
      select: { available: true, product: { select: { itemCode: true } } },
    });
    for (const s of stocks) {
      const code = s.product.itemCode;
      availableByItem.set(code, (availableByItem.get(code) ?? 0) + s.available);
    }
  }

  // ── BON DE COMMANDE / PRÉCOMMANDE : aucun auto-lot ──
  // Choix explicite (docKind="COMMANDE") OU précommande (livraison au-delà du
  // prochain jour livrable). Exclut la transformation d'un bon de préparation
  // export (bonPrepId) : là, les lots sont déjà affectés à la main. Ces commandes
  // partent en EM_PENDING sur CHAQUE ligne — on ne colle plus un lot pas en stock —
  // et sont marquées pour remonter dans l'onglet « Bons de commande ».
  const isBonCommande = !body.bonPrepId && (body.docKind === "COMMANDE" || isPrecommande(body.deliveryDate));

  const documentLines: Record<string, unknown>[] = [];
  let totalNetKgPre = 0;
  let estimatedHTPre = 0;
  for (const l of body.lines) {
    const meta = productMap.get(l.itemCode);
    const line: Record<string, unknown> = {
      ItemCode: l.itemCode,
      Quantity: l.quantity,
    };
    if (l.warehouseCode) line.WarehouseCode = l.warehouseCode;
    // Le user pousse son prix unitaire HT par unité de stock SAP (= prix /pie ou /kg).
    // ⚠️ Pas de division ni multiplication ici : le prix saisi est DÉJÀ à l'unité de stock.
    // SAP B1 Service Layer expose ce prix sur `UnitPrice` (avant remise) — `Price` est en
    // lecture seule sur certaines versions. On envoie les deux pour couvrir les variantes.
    if (l.price != null && l.price > 0) {
      line.UnitPrice = l.price;
      line.Price = l.price;
    }
    // Remise % par ligne (contrat front — mention promos). Clamp 0-100, ignoré si absent/invalide.
    if (typeof l.discountPercent === "number" && Number.isFinite(l.discountPercent) && l.discountPercent > 0) {
      line.DiscountPercent = Math.min(100, Math.max(0, l.discountPercent));
    }

    // === Champs custom Gervifrais sur la ligne ===
    if (meta?.uPays) line.U_GER_Pays = meta.uPays;
    if (meta?.uMarque) line.U_GER_Marque = meta.uMarque;
    if (meta?.uCondi) line.U_GER_Condi = meta.uCondi;
    if (l.warehouseCode) line.U_NomMag = WAREHOUSE_NAMES[l.warehouseCode] ?? l.warehouseCode;

    // === TPF2 ITFL + TPF3 DDG en DocumentLineAdditionalExpenses (line-level) ===
    // Formules calibrées sur BL manuel #24011199 (logique add-on "ORDELION : Calcul gervi supp") :
    //   TPF2 INTERFEL  → GroupCode 1, ExpenseCode 2, LineTotal = LineHT × 0,21 %
    //   TPF3 DDG       → GroupCode 2, ExpenseCode 3, LineTotal = nb_colis × 0,02 €
    //                    où nb_colis = qty_inventaire / salesQtyPerPackUnit (= 1 si pas d'emballage)
    if (TPF_AUTO) {
      const lineHT  = (l.price ?? 0) > 0 ? l.price! * l.quantity : 0;
      const lineKg  = (meta?.salesUnitWeight ?? 0) > 0 ? (meta!.salesUnitWeight!) * l.quantity : 0;
      const packDiv = (meta?.salesQtyPerPackUnit && meta.salesQtyPerPackUnit > 1)
                       ? meta.salesQtyPerPackUnit : 1;
      const nbColis = l.quantity / packDiv;                 // ex. 40/1=40, 12/12=1, 104/104=1
      totalNetKgPre  += lineKg;
      estimatedHTPre += lineHT;
      const lineExpenses: Record<string, unknown>[] = [];
      const itfelAmt = itfelMaster && lineHT > 0
        ? Math.round(lineHT * ((itfelMaster.U_Taux || 0.21) / 100) * 100) / 100 : 0;
      const ddgAmt = ddgMaster && nbColis > 0
        ? Math.round(nbColis * (ddgMaster.U_Taux || 0.02) * 100) / 100 : 0;
      if (itfelAmt > 0) lineExpenses.push({ GroupCode: 1, ExpenseCode: 2, LineTotal: itfelAmt });
      if (ddgAmt   > 0) lineExpenses.push({ GroupCode: 2, ExpenseCode: 3, LineTotal: ddgAmt });
      if (lineExpenses.length > 0) line.DocumentLineAdditionalExpenses = lineExpenses;
    }

    // === Bon de commande / précommande : lot EN ATTENTE (affectation manuelle) ===
    // On NE résout AUCUN lot ici (fini les lots pas en stock) : chaque ligne part
    // en EM_PENDING et sera affectée depuis l'onglet « Bons de commande ».
    if (isBonCommande) {
      line.U_NoLot = LOT_PENDING;
      documentLines.push(line);
      continue;
    }

    // === Numéro de lot (U_NoLot) — SYSTÉMATIQUE sur chaque ligne ===
    // (Bug BL 24011560 : la ligne fraise est partie sans lot exploitable.)
    // Décision pure & testée dans lib/gervifrais-calc.ts (chooseLot) :
    //   • lot "EM<DocNum>" choisi PAR SEGMENT CLIENT (resolveLotForSegment) :
    //     EM affectée au segment du client d'abord, sinon EM « Tous » (stock
    //     commun) — jamais l'EM d'un autre segment (arrivage dédié export ≠
    //     stock GMS). Nécessite du stock (miroir local OU QuantityOnStock SAP,
    //     filet quand le miroir est en retard) ;
    //   • sinon sentinel LOT_PENDING ("EM_PENDING") — vente à découvert, aucune
    //     EM compatible avec le segment, ou article hors fenêtre de scan PDN —
    //     réécrit par /api/sap/goods-receipts à la prochaine entrée marchandise
    //     compatible. Fini le fallback aveugle "EM0000".
    // Lot AFFECTÉ en amont (bon de préparation export) : posé tel quel, aucune
    // résolution automatique ni réalignement de magasin — c'est le lot choisi
    // à la main depuis les arrivages.
    const forcedLot = typeof l.lot === "string" && l.lot.trim() ? l.lot.trim() : null;
    // Ligne à découvert (découpe front) : la quantité en stock est déjà sur ses
    // propres lignes (magasin + lot corrects) — celle-ci part SANS lot EM, en
    // attente de réception. Ne surtout pas résoudre un lot via le stock agrégé
    // de l'article : c'est ce qui mettait tout le surplus sur un vrai lot et
    // rendait les magasins négatifs.
    const isDecouvert = l.decouvert === true && !forcedLot;
    const availLocal = availableByItem.get(l.itemCode) ?? 0;
    const sapOnHand = sapStockByItem.get(l.itemCode) ?? null;
    const resolved = forcedLot || isDecouvert
      ? { lot: forcedLot, source: null, docNum: null, warehouse: null }
      : resolveLotForSegment(lotMaps, emAffects, l.itemCode, l.warehouseCode, clientSegment);
    const choice = forcedLot
      ? { lot: forcedLot, reason: "affecté (bon de préparation)" }
      : isDecouvert
      ? { lot: LOT_PENDING, reason: "decouvert (ligne séparée)" }
      : chooseLot({
          resolvedLot: resolved.lot,
          localAvailable: availLocal,
          sapOnHand,
          envDefault: process.env.GERVIFRAIS_LOT_DEFAUT ?? null,
        });
    line.U_NoLot = choice.lot;
    console.log(
      `[Order] Lot ${l.itemCode}@${l.warehouseCode ?? "?"} [seg ${clientSegment ?? "—"}] → ${choice.lot} ` +
      `(${choice.reason}${resolved.source ? `/${resolved.source}` : ""} — dispo locale ${availLocal}, stock SAP ${sapOnHand ?? "?"})`,
    );

    // Cohérence lot ↔ magasin (vente à découvert) : si le lot retenu provient d'un
    // AUTRE magasin que celui de la ligne (repli "item" → byItemWarehouse), on
    // DÉPLACE la ligne vers ce magasin — sinon on livre depuis un magasin sans
    // stock pour ce lot → « stock dispo négatif ». Uniquement pour un VRAI lot EM
    // (pas le sentinel à découvert, repris plus tard par la réception) et quand la
    // ligne portait déjà un magasin (on déplace, on n'en invente jamais un).
    if (
      choice.lot !== LOT_PENDING &&
      resolved.source === "item" &&
      resolved.warehouse &&
      l.warehouseCode &&
      resolved.warehouse !== l.warehouseCode
    ) {
      line.WarehouseCode = resolved.warehouse;
      line.U_NomMag = WAREHOUSE_NAMES[resolved.warehouse] ?? resolved.warehouse;
      console.log(
        `[Order] Magasin aligné sur le lot ${l.itemCode} : ${l.warehouseCode} → ${resolved.warehouse} (lot ${choice.lot})`,
      );
    }

    documentLines.push(line);
  }

  if (TPF_AUTO) {
    console.log(`[Order] TPF par ligne — ΣHT≈${estimatedHTPre.toFixed(2)}€ Σkg≈${totalNetKgPre.toFixed(2)}`);
  }

  const payload: Record<string, unknown> = {
    CardCode: cardCode,
    DocDate: today,
    DocDueDate: dueDate,
    TaxDate: today,
    // `comments` (contrat front — mention des promos sur le bon) prioritaire sur
    // l'historique `comment`, sinon signature TeleVent par défaut.
    Comments: body.comments?.trim() || body.comment?.trim()
      || docLabel("BL", session.user?.name, session.user?.email),
    DocumentLines: documentLines,
  };
  // N° de commande client → champ SAP NumAtCard (réf. visible sur le BL)
  if (body.numAtCard?.trim()) payload.NumAtCard = body.numAtCard.trim();

  // C11 — Transporteur → ORDR.U_TrspCode.
  // Si carrierId fourni : on résout via la table Carrier (champ U_TrspCode = sapValue).
  // Sinon carrierCode raccourci (déjà la valeur SAP).
  // Sinon : transporteur PAR DÉFAUT du client = ligne principale SERG_TRCL
  // (U_TrspDef='O'). On NE prend JAMAIS « le plus utilisé » : si SERG_TRCL n'est
  // pas lisible, on ne pose rien → défaut SAP, ajustable dans « Détail livraison ».
  let trspCode: string | null = null;
  let trspHeure: string | null = null;
  if (body.trspCode?.trim()) {
    // Choix explicite à la création (sélecteur du dialogue BL) — prioritaire.
    trspCode = body.trspCode.trim();
    trspHeure = (body.trspHeure ?? "").trim() || null;
  } else if (body.carrierId) {
    const rows = await prisma.$queryRawUnsafe<{ sapValue: string | null; active: boolean }[]>(
      `SELECT "sapValue", "active" FROM "Carrier" WHERE "id" = $1 LIMIT 1`,
      body.carrierId,
    );
    if (rows[0]?.active && rows[0].sapValue) trspCode = rows[0].sapValue;
  } else if (body.carrierCode?.trim()) {
    trspCode = body.carrierCode.trim();
  } else {
    // 1) Défaut SERG_TRCL (vue v2, vérité métier) → transporteur + heure de tournée.
    try {
      const def = await getTrclDefaultCarrier(cardCode);
      if (def) {
        trspCode = def.sapValue;
        trspHeure = def.heure ?? null;
        console.log(`[Order] Défaut SERG_TRCL ${cardCode} → ${def.sapValue}${def.tour ? ` (tournée ${def.tour})` : ""}${def.heure ? ` @${def.heure}` : ""}`);
      }
    } catch (e) {
      console.warn(`[Order] Résolution défaut SERG_TRCL ${cardCode} échouée (non-bloquant):`, (e as Error).message);
    }
    // 2) Repli : tournée mémorisée par l'app (si SERG_TRCL indispo pour ce client).
    if (!trspCode) {
      try {
        const mem = await getClientTournee(cardCode);
        if (mem) {
          trspCode = mem.trspCode;
          trspHeure = mem.heure;
          console.log(`[Order] Tournée mémorisée ${cardCode} → ${mem.trspCode}${mem.heure ? ` @${mem.heure}` : ""}`);
        } else {
          console.log(`[Order] Pas de défaut (ni SERG_TRCL ni mémoire) pour ${cardCode} — à régler dans Détail livraison`);
        }
      } catch (e) {
        console.warn(`[Order] Lecture tournée mémorisée ${cardCode} échouée (non-bloquant):`, (e as Error).message);
      }
    }
  }
  // ── Filet TOURNÉE : compléter l'heure quand le transporteur est choisi via
  // l'UI (carrierId / carrierCode) — ce chemin ne transmet QUE le code, jamais
  // l'heure, donc la commande partait avec le bon transporteur mais SANS sa
  // tournée (U_TrspHeur vide → non rattachée au récap transporteur SAP).
  // On résout l'heure de SA tournée depuis SERG_TRCL, puis à défaut depuis la
  // tournée mémorisée du client si elle vise le même transporteur. Non-bloquant.
  if (trspCode && !trspHeure) {
    try {
      const h = await getTrclCarrierHeure(cardCode, trspCode);
      if (h) {
        trspHeure = h;
        console.log(`[Order] Heure de tournée SERG_TRCL ${cardCode}/${trspCode} → @${h}`);
      }
    } catch (e) {
      console.warn(`[Order] Résolution heure tournée ${cardCode}/${trspCode} échouée (non-bloquant):`, (e as Error).message);
    }
    if (!trspHeure) {
      try {
        const mem = await getClientTournee(cardCode);
        if (mem && mem.heure && mem.trspCode.trim().toUpperCase() === trspCode.trim().toUpperCase()) {
          trspHeure = mem.heure;
          console.log(`[Order] Heure de tournée mémorisée ${cardCode}/${trspCode} → @${mem.heure}`);
        }
      } catch (e) {
        console.warn(`[Order] Lecture heure tournée mémorisée ${cardCode} échouée (non-bloquant):`, (e as Error).message);
      }
    }
  }
  if (trspCode) {
    payload.U_TrspCode = trspCode;
    // Heure de la tournée → ORDR.U_TrspHeur (le BL remonte dans l'état « récap
    // transporteur »). Absente si aucune tournée connue pour ce client.
    if (trspHeure) payload.U_TrspHeur = trspHeure;
    // Timbre du transporteur (en-tête SERGTRS) → ORDR.U_Timbre.
    try {
      const timbre = await getTransporteurTimbre(trspCode);
      if (timbre != null) payload.U_Timbre = timbre;
    } catch (e) {
      console.warn(`[Order] Timbre SERGTRS '${trspCode}' non résolu (non-bloquant):`, (e as Error).message);
    }
  }
  // ⚠️ Plus de DocumentAdditionalExpenses doc-level — TPF2/TPF3 sont désormais
  // attachés par ligne dans DocumentLineAdditionalExpenses (cf. BL #24011199 manuel)

  // (Pré-validation items : remontée en 2.1, avant la construction des lignes —
  //  le même appel SAP fournit QuantityOnStock pour la décision de lot.)

  // CardCode + garde-fou encours / blocage
  type SapBp = { CardCode: string; Frozen?: string; Valid?: string;
    CreditLimit?: number; CurrentAccountBalance?: number };
  let bp: SapBp | null = null;
  try {
    bp = await sap.get<SapBp>(
      `BusinessPartners('${encodeURIComponent(cardCode)}')?$select=CardCode,Frozen,Valid,CreditLimit,CurrentAccountBalance`,
    );
  } catch {
    return NextResponse.json({
      ok: false,
      error: `Client "${cardCode}" inexistant dans SAP "${process.env.SAP_B1_COMPANY_DB}". Vérifie le code ou la base SAP cible.`,
    }, { status: 400 });
  }

  // Blocage dur : compte gelé ou invalide dans SAP → on refuse toujours.
  if (bp.Frozen === "tYES" || bp.Valid === "tNO") {
    return NextResponse.json({
      ok: false, blocked: true,
      error: `Client "${cardCode}" ${bp.Frozen === "tYES" ? "GELÉ" : "invalide"} dans SAP. Commande impossible — contacte la compta.`,
    }, { status: 409 });
  }
  // Avertissement encours : solde ≥ limite de crédit (limite > 0). Override possible
  // côté UI en renvoyant confirmEncours=true.
  const creditLimit = bp.CreditLimit ?? 0;
  const balance = bp.CurrentAccountBalance ?? 0;
  if (creditLimit > 0 && balance >= creditLimit && !(body as { confirmEncours?: boolean }).confirmEncours) {
    return NextResponse.json({
      ok: false, needsConfirm: "encours",
      encours: { balance, creditLimit },
      error: `Encours dépassé : solde ${balance.toFixed(2)} € ≥ limite ${creditLimit.toFixed(2)} €. Confirme pour forcer la commande.`,
    }, { status: 409 });
  }

  // ── 2.9. Garde-fou ABSOLU : aucune ligne ne part sans U_NoLot ──
  // (exigence post-bug BL 24011560 — quel que soit le chemin emprunté plus haut,
  //  une ligne sans lot reçoit le sentinel, et c'est loggé en erreur pour enquête.)
  for (const dl of documentLines) {
    const lot = typeof dl.U_NoLot === "string" ? dl.U_NoLot.trim() : "";
    if (!lot) {
      console.error(`[Order] ⚠️ Ligne ${dl.ItemCode} SANS lot au moment du POST — sentinel ${LOT_PENDING} forcé`);
      dl.U_NoLot = LOT_PENDING;
    }
  }

  // ── 3. POST to SAP ─────────────────────────────────────
  // Un BON DE COMMANDE (précommande ou choix explicite) = une OFFRE CLIENT SAP
  // (Quotation), PAS une commande engagée : elle ne réserve pas de stock et
  // n'entre pas dans les KPI. Elle sera « passée en commande » (convertie en
  // Order) au jour de départ depuis l'onglet Bons de commande. Une vraie
  // livraison (BL) reste une Commande client (Order). Cf. lib/livraison.
  const targetEntity = isBonCommande ? "Quotations" : "Orders";
  console.log(`[Order] → POST SAP/${targetEntity} — DB:`, process.env.SAP_B1_COMPANY_DB);
  console.log("[Order]   CardCode:", cardCode, "| Date:", dueDate, "| Lignes:", body.lines.length);

  try {
    type SapOrder = { DocEntry: number; DocNum: number; DocTotal?: number; VatSum?: number };
    const created = await sap.post<SapOrder>(`/${targetEntity}`, payload);

    console.log(`[Order] ✅ SUCCESS (${targetEntity}) — DocNum:`, created.DocNum, "| DocEntry:", created.DocEntry, "| Total:", created.DocTotal);
    // NB : on ne marque plus l'offre via setDeliveryBonCommande — les offres sont
    // découvertes en interrogeant les Quotations ouvertes (cf. /api/bons-commande).
    // Le marquage « lots à affecter » est posé sur la COMMANDE issue de la
    // conversion (offre → commande), pas sur l'offre.

    // Mémorise (best-effort) la tournée CHOISIE à la création pour ce client —
    // même mécanique que le PATCH « Détail livraison » : ré-appliquée en
    // auto-remplissage aux prochaines commandes. Uniquement sur choix EXPLICITE
    // (body.trspCode, envoyé par les sélecteurs de création) — jamais sur les
    // défauts résolus serveur (ils re-dériveront de la même source la prochaine fois).
    // Condition body.tournee : on n'enregistre QUE si une VRAIE tournée a été
    // retenue — sinon on n'écrase pas une mémoire plus riche (nom/des/lineId
    // posés par « Détail livraison ») avec des null.
    if (body.trspCode?.trim() && body.tournee) {
      try {
        await setClientTournee(cardCode, {
          trspCode: body.trspCode.trim(),
          heure: trspHeure,
          nom: body.tournee.nom ?? null,
          des: body.tournee.des ?? null,
          lineId: body.tournee.lineId ?? null,
        });
      } catch (e) {
        console.warn(`[Order] Mémorisation tournée ${cardCode} échouée (non-bloquant):`, (e as Error).message);
      }
    }

    // Décrément optimiste local — latence 0 pour le commercial. La sync delta
    // corrigera au tick suivant si besoin (SAP est source de vérité).
    // ⚠️ PAS pour une offre client : elle n'engage pas de stock (Committed) tant
    // qu'elle n'est pas passée en commande.
    if (!isBonCommande) {
      try {
        await decrementLocalStock(body.lines.map((l) => ({
          itemCode: l.itemCode,
          quantity: l.quantity,
          warehouseCode: l.warehouseCode,
        })));
      } catch (e) {
        console.warn("[Order] decrementLocalStock échoué (non-bloquant):", (e as Error).message);
      }
    }

    // Refetch la commande créée pour récupérer les U_NoLot / prix / taxes appliqués par SAP
    // TPF2/TPF3 sont DANS chaque ligne (DocumentLineAdditionalExpenses), pas doc-level.
    // Doc-line expense key = `ExpenseCode` (avec e) ; master = `ExpensCode` (sans — typo SAP).
    type EnrichedLineExpense = {
      GroupCode: number; ExpenseCode: number; LineTotal: number;
      TaxSum?: number; TaxPercent?: number; VatGroup?: string;
    };
    type EnrichedLine = {
      LineNum?: number; ItemCode: string; ItemDescription?: string; Quantity: number;
      Price?: number; LineTotal?: number; TaxTotal?: number; TaxPercentagePerRow?: number;
      WarehouseCode?: string; U_NoLot?: string; MeasureUnit?: string;
      DocumentLineAdditionalExpenses?: EnrichedLineExpense[];
    };
    type EnrichedExpense = {
      ExpenseCode: number; LineTotal: number; TaxSum?: number; TaxPercent?: number;
      LineGross?: number; VatGroup?: string;
    };
    type EnrichedOrder = {
      DocEntry: number; DocNum: number; DocDate: string; DocDueDate: string;
      DocTotal: number; VatSum: number; DocTotalSys?: number;
      CardCode: string; CardName: string;
      DocumentLines: EnrichedLine[];
      DocumentAdditionalExpenses?: EnrichedExpense[];
    };
    let enriched: EnrichedOrder | null = null;
    try {
      enriched = await sap.get<EnrichedOrder>(`/${targetEntity}(${created.DocEntry})`);
    } catch (e) {
      console.warn("[Order] Refetch failed (non-blocking):", (e as Error).message);
    }

    // ── 3.5. Réconciliation TPF — INTERFEL/DDG recalculés depuis le LineTotal RÉEL ──
    // Indispensable quand le prix est laissé au tarif SAP : le HT n'est connu qu'après
    // création, donc l'INTERFEL (% du HT) n'a pas pu être posé à la création. On le
    // corrige ici par PATCH. Garantit des TPF justes à 100%, quel que soit le mode de prix.
    // (Smoke test : 23/55 BL concernés par des lignes sans prix saisi.)
    if (enriched && TPF_AUTO) {
      const itfelRate = (itfelMaster?.U_Taux ?? 0.21) / 100;   // % du HT
      const ddgRate   = ddgMaster?.U_Taux ?? 0.02;             // €/colis
      const patchLines: Record<string, unknown>[] = [];
      for (const l of enriched.DocumentLines) {
        const prod = productMap.get(l.ItemCode);
        const packDiv = (prod?.salesQtyPerPackUnit && prod.salesQtyPerPackUnit > 1) ? prod.salesQtyPerPackUnit : 1;
        const lineHT = l.LineTotal ?? 0;
        const nbColis = (l.Quantity ?? 0) / packDiv;
        const expItfel = Math.round(lineHT * itfelRate * 100) / 100;
        const expDdg   = Math.round(nbColis * ddgRate * 100) / 100;
        const exps = l.DocumentLineAdditionalExpenses || [];
        const curItfel = exps.find((e) => e.ExpenseCode === 2)?.LineTotal ?? 0;
        const curDdg   = exps.find((e) => e.ExpenseCode === 3)?.LineTotal ?? 0;
        if (Math.abs(expItfel - curItfel) > 0.005 || Math.abs(expDdg - curDdg) > 0.005) {
          const merged: Record<string, unknown>[] = [];
          if (expItfel > 0) merged.push({ GroupCode: 1, ExpenseCode: 2, LineTotal: expItfel });
          if (expDdg > 0)   merged.push({ GroupCode: 2, ExpenseCode: 3, LineTotal: expDdg });
          patchLines.push({ LineNum: l.LineNum, DocumentLineAdditionalExpenses: merged });
        }
      }
      if (patchLines.length > 0) {
        try {
          await sap.patch(`${targetEntity}(${created.DocEntry})`, { DocumentLines: patchLines });
          console.log(`[Order] TPF réconcilié sur ${patchLines.length} ligne(s) (tarif SAP) → re-fetch`);
          enriched = await sap.get<EnrichedOrder>(`/${targetEntity}(${created.DocEntry})`);
        } catch (e) {
          console.warn("[Order] PATCH réconciliation TPF échoué (non-bloquant):", (e as Error).message);
        }
      }
    }

    // ── 3.6. Insert OPTIMISTE dans le miroir local (KPI du jour à latence 0) ──
    // Pendant du décrément de stock optimiste : la commande remonte dans les
    // agrégats pilotage (accueil / Écran 1) SANS attendre la prochaine synchro
    // SAP. Réutilise `enriched` déjà ramené — aucun appel SAP supplémentaire.
    // Idempotent : la synchro suivante réécrira proprement la ligne.
    // ⚠️ PAS pour une offre client : elle n'est pas une commande engagée → ne doit
    // pas remonter dans les agrégats pilotage tant qu'elle n'est pas passée en commande.
    if (enriched && !isBonCommande) {
      try {
        await mirrorCreatedOrder(enriched);
      } catch (e) {
        console.warn("[Order] Miroir optimiste échoué (non-bloquant, rattrapé à la synchro):", (e as Error).message);
      }
    }

    // ── 4. Log internal AppelLog COMMANDE (snooze jusqu'à la livraison) ──
    try {
      // Construit une note riche avec les lots assignés
      const lotsList = (enriched?.DocumentLines || [])
        .filter((l) => l.U_NoLot)
        .map((l) => `${l.ItemCode}→lot ${l.U_NoLot}`)
        .join(", ");
      const noteParts = [
        `${isBonCommande ? "Offre client" : "Commande"} #${created.DocNum} créée dans SAP`,
        cardCode !== client.code ? `(via ${cardCode})` : null,
        enriched ? `Total ${enriched.DocTotal.toFixed(2)} € TTC` : null,
        lotsList ? `Lots: ${lotsList}` : null,
        body.comment || null,
      ].filter(Boolean);
      await prisma.appelLog.create({
        data: {
          clientId: client.id,
          type: "COMMANDE",
          outcome: "COMMANDE",
          note: noteParts.join(" — "),
          heureAppel: new Date(),
          scheduledFor: new Date(body.deliveryDate),
          createdBy: session.user?.email ?? null,
        },
      });
    } catch (e) {
      console.error("[Order] AppelLog post-create failed (non-fatal):", e);
    }

    // ── 4b. Notification push « nouvelle commande » (abonnés opt-in, sauf l'auteur) ──
    try {
      const clientNom = client.nom ?? cardCode;
      const nbLignes = body.lines.length;
      const ttc = enriched?.DocTotal ?? created.DocTotal ?? 0;
      await notifyAll(
        isBonCommande
          ? {
              title: "🆕 Nouvelle offre client",
              body: `${clientNom} — ${nbLignes} ligne${nbLignes > 1 ? "s" : ""}${ttc ? ` · ${Math.round(ttc)} € TTC` : ""} (offre n°${created.DocNum}) — à passer en commande au départ`,
              url: "/bons-commande",
              tag: `offre-${created.DocEntry}`,
            }
          : {
              title: "🆕 Nouvelle commande",
              body: `${clientNom} — ${nbLignes} ligne${nbLignes > 1 ? "s" : ""}${ttc ? ` · ${Math.round(ttc)} € TTC` : ""} (BL n°${created.DocNum})`,
              url: "/livraisons",
              tag: `order-${created.DocEntry}`,
            },
        { exceptEmail: session.user?.email ?? null },
      );
    } catch (e) {
      console.error("[Order] Notif push nouvelle commande échouée (non-fatal):", e);
    }

    // Transformation d'un bon de préparation → marquer le bon (best-effort).
    if (body.bonPrepId) {
      try {
        await markBonPrepTransformed(body.bonPrepId, { docNum: created.DocNum, docEntry: created.DocEntry });
      } catch (e) {
        console.warn("[Order] Marquage du bon de préparation échoué (non-bloquant):", (e as Error).message);
      }
    }

    return NextResponse.json({
      ok: true,
      // true = OFFRE CLIENT (Quotation) créée : à passer en commande au jour de
      // départ depuis l'onglet Bons de commande. false = Commande client (BL).
      offre: isBonCommande,
      docNum: created.DocNum,
      docEntry: created.DocEntry,
      cardCode,
      db: process.env.SAP_B1_COMPANY_DB,
      // Valeurs SAP réelles (calculées par SAP)
      totalHT: enriched ? enriched.DocTotal - enriched.VatSum : created.DocTotal,
      totalTVA: enriched?.VatSum ?? 0,
      totalTTC: enriched?.DocTotal ?? created.DocTotal,
      // Frais para-fiscaux agrégés depuis les LIGNES (DocumentLineAdditionalExpenses).
      // Pour chaque ExpenseCode présent, on somme LineTotal et TaxSum à travers les lignes.
      expenses: (() => {
        const agg = new Map<number, { amount: number; tax: number; taxPercent: number | null; vatGroup: string | null }>();
        for (const l of (enriched?.DocumentLines || [])) {
          for (const le of (l.DocumentLineAdditionalExpenses || [])) {
            const cur = agg.get(le.ExpenseCode) || { amount: 0, tax: 0, taxPercent: le.TaxPercent ?? null, vatGroup: le.VatGroup ?? null };
            cur.amount += le.LineTotal || 0;
            cur.tax    += le.TaxSum    || 0;
            agg.set(le.ExpenseCode, cur);
          }
        }
        return Array.from(agg.entries()).map(([code, v]) => {
          const def = expensesMasterPreloaded.get(code);
          return {
            code,
            label: def?.Name ?? `Frais #${code}`,
            amount: Math.round(v.amount * 100) / 100,
            tax: Math.round(v.tax * 100) / 100,
            gross: Math.round((v.amount + v.tax) * 100) / 100,
            vatGroup: v.vatGroup ?? def?.OutputVATGroup ?? null,
            taxPercent: v.taxPercent,
          };
        });
      })(),
      totalWeightKg: totalNetKgPre > 0 ? Math.round(totalNetKgPre * 100) / 100 : null,
      // Détail par ligne avec lot, prix et TPF par ligne
      lines: (enriched?.DocumentLines || []).map((l) => ({
        itemCode: l.ItemCode,
        itemName: l.ItemDescription,
        quantity: l.Quantity,
        unit: l.MeasureUnit,
        unitPrice: l.Price,
        lineTotal: l.LineTotal,
        taxAmount: l.TaxTotal,
        taxRate: l.TaxPercentagePerRow,
        warehouse: l.WarehouseCode,
        lot: l.U_NoLot ?? null,
        tpf: (l.DocumentLineAdditionalExpenses || []).map((le) => ({
          group: le.GroupCode,                  // 1 = slot TPF2, 2 = slot TPF3
          code: le.ExpenseCode,                 // 2 = INTERFEL, 3 = DDG
          name: expensesMasterPreloaded.get(le.ExpenseCode)?.Name ?? null,
          amount: le.LineTotal,
          tax: le.TaxSum ?? 0,
        })),
      })),
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error("[Order] ❌ SAP CREATE FAILED");
    console.error("[Order]    Message:", message);
    console.error("[Order]    DB:", process.env.SAP_B1_COMPANY_DB);
    console.error("[Order]    CardCode:", cardCode);
    console.error("[Order]    Payload sent:", JSON.stringify(payload, null, 2));
    return NextResponse.json(
      { ok: false, error: message, payload: process.env.NODE_ENV === "development" ? payload : undefined },
      { status: 500 },
    );
  }
}

/**
 * GET /api/sap/orders
 *   ?last=10                 → dernières Commandes créées (debug/admin)
 *   ?clientId=xxx&last=8      → commandes SAP d'un client (tous ses CardCodes)
 *   ?cardCode=APLAI&last=8    → commandes SAP d'un CardCode précis
 */
export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const last = Math.min(50, parseInt(searchParams.get("last") || "10"));
  const clientId = searchParams.get("clientId");
  const cardCodeParam = searchParams.get("cardCode");

  // Résout l'ensemble des CardCodes SAP du client (code principal + modes de livraison)
  let cardCodes: string[] = [];
  if (cardCodeParam) {
    cardCodes = [cardCodeParam];
  } else if (clientId) {
    const client = await prisma.client.findUnique({ where: { id: clientId }, select: { code: true } });
    if (client?.code) cardCodes.push(client.code);
    try {
      const modes = await prisma.$queryRawUnsafe<{ sapCardCode: string }[]>(
        `SELECT DISTINCT "sapCardCode" FROM "ClientDeliveryMode" WHERE "clientId" = $1`, clientId,
      );
      for (const m of modes) if (m.sapCardCode && !cardCodes.includes(m.sapCardCode)) cardCodes.push(m.sapCardCode);
    } catch { /* table peut être absente — on garde le code principal */ }
  }

  try {
    type ListedLine = { ItemCode: string; Quantity: number };
    type SapOrderListed = { DocEntry: number; DocNum: number; DocDate: string; DocDueDate: string;
      CardCode: string; CardName?: string; DocTotal?: number; VatSum?: number;
      DocumentStatus?: string; Comments?: string; NumAtCard?: string; DocumentLines?: ListedLine[] };

    // Filtre OData par CardCode(s) si fourni
    const filter = cardCodes.length > 0
      ? "&$filter=" + encodeURIComponent(cardCodes.map((c) => `CardCode eq '${c.replace(/'/g, "''")}'`).join(" or "))
      : "";
    const docs = await sap.get<{ value: SapOrderListed[] }>(
      `Orders?$top=${last}&$orderby=DocEntry desc`
      + `&$select=DocEntry,DocNum,DocDate,DocDueDate,CardCode,CardName,DocTotal,VatSum,DocumentStatus,Comments,NumAtCard,DocumentLines`
      + filter,
    );

    // Poids net par commande = Σ(quantité_inventaire × poids unitaire) — depuis la DB.
    const allItemCodes = Array.from(new Set((docs.value || []).flatMap((d) => (d.DocumentLines || []).map((l) => l.ItemCode))));
    const weightByItem = new Map<string, number>();
    // unités de base par colis (diviseur EXACT) — cf. colisInfo (lib/colis).
    const unitsPerColisByItem = new Map<string, number>();
    if (allItemCodes.length > 0) {
      const prods = await prisma.product.findMany({
        where: { itemCode: { in: allItemCodes } },
        select: { itemCode: true, salesUnit: true, salesUnitWeight: true, salesQtyPerPackUnit: true },
      });
      for (const p of prods) {
        weightByItem.set(p.itemCode, p.salesUnitWeight ?? 0);
        // Nb de colis EXACT : on divise la quantité d'inventaire par unitsPerColis
        // (kg/colis pour les articles au poids, SalPackUn pour pie/barquette/colis).
        // Fini l'« approximatif » : plus de comptage « 1 kg = 1 colis ».
        unitsPerColisByItem.set(p.itemCode, colisInfo(p).unitsPerColis);
      }
    }
    const weightOf = (d: SapOrderListed) =>
      (d.DocumentLines || []).reduce((s, l) => s + (l.Quantity || 0) * (weightByItem.get(l.ItemCode) ?? 0), 0);
    // Nombre de colis EXACT = Σ(quantité_inventaire / unités-par-colis).
    const colisOf = (d: SapOrderListed) =>
      (d.DocumentLines || []).reduce((s, l) => s + (l.Quantity || 0) / (unitsPerColisByItem.get(l.ItemCode) || 1), 0);

    // ── Factures liées : une facture référence la commande via BaseType=17 + BaseEntry=DocEntry ──
    // On scanne les factures du/des CardCode(s) et on mappe DocEntry commande → facture.
    const invoiceByOrder = new Map<number, { docNum: number; docEntry: number }>();
    if (cardCodes.length > 0) {
      try {
        type Inv = { DocEntry: number; DocNum: number; DocumentLines?: { BaseType?: number; BaseEntry?: number }[] };
        const invFilter = cardCodes.map((c) => `CardCode eq '${c.replace(/'/g, "''")}'`).join(" or ");
        const inv = await sap.get<{ value: Inv[] }>(
          `Invoices?$top=60&$orderby=DocEntry desc&$select=DocEntry,DocNum,DocumentLines&$filter=${encodeURIComponent(invFilter)}`,
        );
        for (const f of (inv.value || [])) {
          for (const l of (f.DocumentLines || [])) {
            if (l.BaseType === 17 && l.BaseEntry != null && !invoiceByOrder.has(l.BaseEntry)) {
              invoiceByOrder.set(l.BaseEntry, { docNum: f.DocNum, docEntry: f.DocEntry });
            }
          }
        }
      } catch { /* facture optionnelle */ }
    }

    return NextResponse.json({
      db: process.env.SAP_B1_COMPANY_DB,
      cardCodes,
      count: docs.value?.length || 0,
      docs: (docs.value || []).map((d) => ({
        docEntry: d.DocEntry,
        docNum: d.DocNum,
        docDate: d.DocDate,
        dueDate: d.DocDueDate,
        cardCode: d.CardCode,
        cardName: d.CardName,
        total: d.DocTotal ?? 0,
        totalHT: (d.DocTotal ?? 0) - (d.VatSum ?? 0),
        status: d.DocumentStatus,          // bost_Open | bost_Close
        comments: d.Comments,
        numAtCard: d.NumAtCard ?? "",       // N° commande client
        weightKg: Math.round(weightOf(d) * 10) / 10,                 // poids net total
        colis: Math.round(colisOf(d) * 10) / 10,                     // nb de colis (console : remplace le HT)
        invoiceNum: invoiceByOrder.get(d.DocEntry)?.docNum ?? null,   // facture liée
        invoiceEntry: invoiceByOrder.get(d.DocEntry)?.docEntry ?? null,
      })),
    });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}

/**
 * PATCH /api/sap/orders
 * Body: { docEntry: number, numAtCard: string }
 * Met à jour le champ NumAtCard (n° de commande client) d'une commande SAP existante.
 */
export async function PATCH(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

  let body: { docEntry?: number; numAtCard?: string };
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: "JSON invalide" }, { status: 400 }); }

  if (!body.docEntry || typeof body.docEntry !== "number") {
    return NextResponse.json({ error: "docEntry requis" }, { status: 400 });
  }
  const numAtCard = (body.numAtCard ?? "").trim();

  try {
    // SAP PATCH partiel : ne modifie que NumAtCard
    await sap.patch(`Orders(${body.docEntry})`, { NumAtCard: numAtCard });
    return NextResponse.json({ ok: true, docEntry: body.docEntry, numAtCard });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error("[Order] PATCH NumAtCard failed:", message);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
