import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { docRef } from "@/lib/docLabel";
import { prisma } from "@/lib/prisma";
import { sap } from "@/lib/sapb1";
import { isAgreeur, requirePreparateurOrAdmin } from "@/lib/permissions";
import { incrementLocalStock } from "@/lib/stockSync";
import { bumpLot, LOT_PENDING } from "@/lib/lotResolver";
import { buildWhsBudget, remainingForItem, pickReceiptWarehouse, consumeBudget } from "@/lib/receiptRetro";
import { normalizeEmAffect, setEmAffect } from "@/lib/emAffect";
import { setEmGroup, getEmGroups } from "@/lib/emGroup";
import { creditLots, debitLots } from "@/lib/lotLedger";
import { setMarchandiseNote, sanitizeRating, getLotNotesForPairs } from "@/lib/marchandiseNote";
import { convertQuotationToOrder } from "@/lib/quotationConvert";
import { isDepartureReached } from "@/lib/livraison";

/**
 * POST /api/sap/goods-receipts
 *
 * Crée une ENTRÉE MARCHANDISE dans SAP B1, façon Goods Receipt — entrée libre
 * (sans PO), multi-entrepôts par ligne.
 *
 * ⚠️ DÉCOUPAGE « UNE EM PAR LIGNE » : chaque ligne saisie devient sa PROPRE
 * PurchaseDeliveryNote SAP (ex. 10 colis + 40 colis → 2 EM), pour avoir un lot,
 * une DLC et une annulation PAR article. Les EM du groupe partagent la même
 * référence (« EM <n° de la 1re> - initiales à heure ») et le même N° BL ;
 * Télévente les regroupe en UNE SEULE entrée à l'affichage (lib/emGroup), avec
 * le n° d'EM propre à chaque ligne.
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
  rating?: number;             // note qualité 1..5 (étoiles) — optionnelle
}
interface CreateBody {
  cardCode: string;
  docDate?: string;       // date de réception (défaut : aujourd'hui)
  docTime?: string;       // heure de réception « HH:MM » (agréage) — reportée dans les Comments
  numAtCard?: string;
  comment?: string;
  /** Affectation de l'EM à un segment client — « TOUS » (défaut), « EXPORT »,
   *  « GMS » ou « CHR ». Une EM affectée réserve son lot au segment (choix du
   *  lot à la saisie télévente) et sert ses commandes en PREMIER lors de la
   *  propagation rétro ci-dessous. Cf. lib/emAffect. */
  affect?: string;
  /** Clé d'idempotence (UUID généré par le client, stable sur les retries d'UNE
   *  soumission) — évite le double BR / double crédit sur double-clic ou retry
   *  réseau. Optionnelle : sans clé, comportement inchangé. */
  idempotencyKey?: string;
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

  // Idempotence (anti double-BR / double-crédit) : clé optionnelle du client, stable
  // sur les retries d'UNE soumission. Le CLAIM atomique se fait juste avant le POST
  // SAP (après les pré-validations, pour ne pas laisser de clé bloquée sur erreur).
  const idemKey = (body.idempotencyKey ?? "").trim().slice(0, 100);
  const idemSettingKey = idemKey ? `gr:idem:${idemKey}` : null;
  const releaseIdem = async () => {
    if (idemSettingKey) await prisma.appSetting.deleteMany({ where: { key: idemSettingKey } }).catch(() => {});
  };

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
  // Fenêtre de RATTRAPAGE rétro (propagation d'EM sur les découverts) : on ne se
  // limite pas au jour même. Un article vendu à découvert il y a quelques jours
  // (BL ouvert en magasin d'attente 000, LOT_PENDING) doit lui AUSSI passer au
  // magasin de réception (01) quand la marchandise arrive — sinon 000 reste
  // négatif et le stock s'accumule en 01 (décalage SAP constaté).
  const RETRO_WINDOW_DAYS = 60;
  const retroSince = new Date(Date.now() - RETRO_WINDOW_DAYS * 86_400_000).toISOString().slice(0, 10);
  // Date du DOCUMENT (réception) : saisie au formulaire ou aujourd'hui. Distincte
  // de `today` (jour réel) qui sert aux scans de propagation rétro ci-dessous.
  const docDate = (body.docDate && /^\d{4}-\d{2}-\d{2}$/.test(body.docDate)) ? body.docDate : today;
  // Heure de réception (agréage) : SAP DocDate est sans heure → on reporte
  // l'heure saisie dans les Comments (« … · Reçu à 14h30 »), visible sur le BR
  // SAP et dans l'historique des entrées.
  const docTime = (body.docTime && /^([01]\d|2[0-3]):[0-5]\d$/.test(body.docTime)) ? body.docTime : null;
  const resolvedLines = body.lines.map((l) => {
    const meta = productMap.get(l.itemCode);
    const ratio = (meta?.salesQtyPerPackUnit && meta.salesQtyPerPackUnit > 1) ? meta.salesQtyPerPackUnit : 1;
    const pieceQty = l.packageQuantity * ratio;
    return { ...l, pieceQty, ratio };
  });
  const heure = docTime ? docTime.replace(":", "h") : null;
  const note = body.comment?.trim() || null;

  // ── Idempotence : CLAIM atomique juste avant le POST (fenêtre minimale) ──
  if (idemSettingKey) {
    const claimed = await prisma.$queryRawUnsafe<{ key: string }[]>(
      `INSERT INTO "AppSetting" ("key", "value", "updatedAt") VALUES ($1, 'pending', NOW())
       ON CONFLICT ("key") DO NOTHING RETURNING "key";`,
      idemSettingKey,
    );
    if (!Array.isArray(claimed) || claimed.length === 0) {
      // Clé déjà présente = doublon : on rejoue le résultat produit, ou 409 si en cours.
      const existing = await prisma.appSetting.findUnique({ where: { key: idemSettingKey } });
      if (existing?.value && existing.value !== "pending") {
        try { return NextResponse.json({ ...JSON.parse(existing.value), idempotent: true }); }
        catch { /* valeur illisible → 409 ci-dessous */ }
      }
      return NextResponse.json(
        { ok: false, error: "Réception déjà en cours (double envoi ignoré)." },
        { status: 409 },
      );
    }
  }

  // ── POST SAP /PurchaseDeliveryNotes — UNE CRÉATION PAR LIGNE ──
  console.log("[GoodsReceipt] → POST SAP/PurchaseDeliveryNotes — DB:", process.env.SAP_B1_COMPANY_DB);
  console.log("[GoodsReceipt]   Fournisseur:", cardCode, "| Lignes:", body.lines.length, "→ 1 EM par ligne");

  type SapPdn = { DocEntry: number; DocNum: number; DocTotal?: number };
  type ResolvedLine = (typeof resolvedLines)[number];
  type CreatedDoc = { docEntry: number; docNum: number; lot: string; line: ResolvedLine };
  const createdDocs: CreatedDoc[] = [];
  // N° du GROUPE = DocNum de la 1re EM créée : c'est LUI que Télévente affiche
  // (« EM # <n°> ») et que chaque EM du groupe porte dans sa référence.
  let groupNum: number | null = null;
  let createError: string | null = null;

  for (const l of resolvedLines) {
    const docLine: Record<string, unknown> = {
      ItemCode: l.itemCode,
      Quantity: l.pieceQty,                 // SAP "Qty Totale" en unité d'inventaire (pie)
      PackageQuantity: l.packageQuantity,   // SAP "Mbre" colis — visible sur le BR
      WarehouseCode: l.warehouseCode,
    };
    if (l.price != null && l.price > 0) {
      docLine.UnitPrice = l.price;
      docLine.Price = l.price;
    }
    const payload: Record<string, unknown> = {
      CardCode: cardCode,
      DocDate: docDate,
      DocDueDate: docDate,
      TaxDate: docDate,
      // Référence signée « EM <n° du groupe> - <initiales> à <heure> ». Pour la
      // 1re EM le n° n'existe qu'après création → provisoire ici, gravée plus
      // bas ; les suivantes portent le n° du groupe dès la création.
      Comments: docRef({ prefix: "EM", docNum: groupNum ?? undefined, name: session.user?.name, email: session.user?.email, heure, note }),
      DocumentLines: [docLine],
    };
    if (body.numAtCard?.trim()) payload.NumAtCard = body.numAtCard.trim();
    try {
      const created = await sap.post<SapPdn>("/PurchaseDeliveryNotes", payload);
      if (groupNum == null) groupNum = created.DocNum;
      createdDocs.push({ docEntry: created.DocEntry, docNum: created.DocNum, lot: `EM${created.DocNum}`, line: l });
    } catch (e) {
      // Échec en cours de route : on N'ESSAIE PAS les lignes suivantes — les EM
      // déjà créées restent valides, l'échec partiel est SIGNALÉ au client.
      createError = e instanceof Error ? e.message : String(e);
      console.error(`[GoodsReceipt] ❌ SAP CREATE FAILED (ligne ${l.itemCode}):`, createError);
      break;
    }
  }

  if (createdDocs.length === 0) {
    await releaseIdem();   // rien créé → on libère la clé pour permettre une vraie relance
    return NextResponse.json({ ok: false, error: createError ?? "Création SAP échouée" }, { status: 500 });
  }

  // EM « primaire » du groupe (la 1re) : porte le n° affiché dans Télévente et
  // reste la clé des champs historiques de la réponse (docNum/docEntry/lot).
  const primary = createdDocs[0];
  const lotCode = primary.lot;
  const docNums = createdDocs.map((d) => d.docNum);
  const failedLines = createError ? resolvedLines.slice(createdDocs.length).map((l) => l.itemCode) : [];
  // Groupe persisté (AppSetting) : l'historique regroupe ces EM en une seule.
  if (createdDocs.length > 1) {
    try { await setEmGroup(primary.docNum, docNums); }
    catch (e) { console.warn("[GoodsReceipt] Enregistrement du groupe d'EM échoué (non-bloquant):", (e as Error).message); }
  }
  // Mémorise le résultat sur la clé d'idempotence — un retry rejouera CE groupe
  // d'EM au lieu d'en créer un second (double crédit évité). ⚠️ En cas d'échec
  // PARTIEL on GARDE la clé : une relance aveugle dupliquerait les EM déjà
  // créées — les lignes manquantes se ressaisissent dans une nouvelle entrée.
  if (idemSettingKey) {
    await prisma.appSetting.update({
      where: { key: idemSettingKey },
      data: {
        value: JSON.stringify({
          ok: true, docNum: primary.docNum, docEntry: primary.docEntry, lot: lotCode,
          docNums, docEntries: createdDocs.map((d) => d.docEntry), lots: createdDocs.map((d) => d.lot), cardCode,
        }),
      },
    }).catch(() => { /* best-effort */ });
  }
  console.log("[GoodsReceipt] ✅ SUCCESS —", createdDocs.length, "EM créée(s) | Groupe EM", primary.docNum, "| DocNums:", docNums.join(", "));

  // ── PATCH par EM : référence gravée (n° du GROUPE) + U_NoLot=EM<DocNum propre> ──
  // (le n° du groupe n'existe qu'après la 1re création — d'où le 2-temps).
  for (const d of createdDocs) {
    try {
      type CreatedLine = { LineNum: number };
      const refetch = await sap.get<{ DocumentLines: CreatedLine[] }>(
        `/PurchaseDeliveryNotes(${d.docEntry})?$select=DocumentLines`,
      );
      const patchLines = (refetch.DocumentLines || []).map((l) => ({
        LineNum: l.LineNum,
        U_NoLot: d.lot,
      }));
      const patchBody: Record<string, unknown> = {
        Comments: docRef({ prefix: "EM", docNum: primary.docNum, name: session.user?.name, email: session.user?.email, heure, note }),
      };
      if (patchLines.length > 0) patchBody.DocumentLines = patchLines;
      await sap.patch(`PurchaseDeliveryNotes(${d.docEntry})`, patchBody);
    } catch (e) {
      console.warn(`[GoodsReceipt] PATCH U_NoLot / référence EM ${d.docNum} échoué (non-bloquant):`, (e as Error).message);
    }
  }

  // ── Cache des lots : injection immédiate pour les Orders qui suivent ──
  for (const d of createdDocs) bumpLot(d.line.itemCode, d.line.warehouseCode, d.docNum);

  // ── REGISTRE DES LOTS : CRÉDIT (réception) ──────────────────────────
  // Chaque lot EM<DocNum> naît ici (un par ligne) : on mémorise la quantité
  // reçue (pie), le fournisseur et le prix d'achat. Le stock par lot est ensuite
  // décrémenté à la vente (cf. /api/sap/orders). Agrégé tous entrepôts
  // (warehouseCode=""), en unité SAP (pie) — cohérent avec la décrémentation.
  try {
    const admission = new Date(`${docDate}T12:00:00Z`);
    await creditLots(createdDocs.map((d) => ({
      itemCode: d.line.itemCode,
      lot: d.lot,
      qty: d.line.pieceQty,
      supplierName: bp.CardName?.trim() || cardCode,
      purchasePrice: d.line.price ?? null,
      currency: "EUR",
      sourceDocNum: String(d.docNum),
      admissionDate: admission,
    })));
  } catch (e) {
    console.warn("[GoodsReceipt] Crédit registre lots échoué (non-bloquant):", (e as Error).message);
  }

  // ── NOTE QUALITÉ (étoiles) de la marchandise reçue — best-effort ──
  // Saisie 1..5 par ligne : note du lot PROPRE à la ligne + note courante de l'article.
  try {
    const by = session.user?.name?.trim() || session.user?.email || null;
    await Promise.all(createdDocs.map((d) => {
      const r = sanitizeRating(d.line.rating);
      return r != null ? setMarchandiseNote(d.line.itemCode, d.lot, r, by) : Promise.resolve();
    }));
  } catch (e) {
    console.warn("[GoodsReceipt] Note qualité non enregistrée (non-bloquant):", (e as Error).message);
  }

  // ── Affectation de l'EM (Tous/Export/GMS/CHR) — persistée par DocNum, posée
  //    sur CHAQUE EM du groupe (le résolveur de lots lit par DocNum). Pilote le
  //    choix du lot à la saisie télévente (resolveLotForSegment) et la priorité
  //    de la propagation rétro ci-dessous. Best-effort. ──
  const affect = normalizeEmAffect(body.affect);
  try {
    await Promise.all(createdDocs.map((d) => setEmAffect(d.docNum, affect)));
  } catch (e) {
    console.warn("[GoodsReceipt] Affectation EM non enregistrée (non-bloquant):", (e as Error).message);
  }

  // ── Propagation rétro : patcher les BL ouverts RÉCENTS (fenêtre glissante,
  //    RETRO_WINDOW_DAYS) qui portent LOT_PENDING sur un item présent dans ce PDN.
  //    FIFO par DocEntry asc, dans la limite de la quantité reçue pour cet item.
  //    (Avant : uniquement le jour même → un découvert d'un autre jour restait
  //    bloqué en magasin 000, jamais relocalisé vers le magasin de réception.)
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
  const budget = buildWhsBudget(createdDocs.map((d) => ({
    itemCode: d.line.itemCode, warehouseCode: d.line.warehouseCode, pieceQty: d.line.pieceQty,
  })));
  // Lot à poser par ARTICLE : avec « une EM par ligne », chaque article reçu a
  // SON propre lot (celui de la 1re EM du groupe qui le porte en cas de doublon).
  const lotByItem = new Map<string, string>();
  for (const d of createdDocs) if (!lotByItem.has(d.line.itemCode)) lotByItem.set(d.line.itemCode, d.lot);

  let retroPatchCount = 0;
  // Débits registre à appliquer une fois les BL patchés : une vente à découvert
  // (EM_PENDING) résolue ici consomme le lot fraîchement reçu — sinon le lot
  // reste crédité de la réception SANS jamais être débité de cette vente (stock
  // fantôme qui « date »). Débité APRÈS le PATCH SAP réussi uniquement.
  const retroDebits: { itemCode: string; lot: string; qty: number }[] = [];
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
      + `&$filter=${encodeURIComponent(`DocDate ge '${retroSince}' and DocumentStatus eq 'bost_Open'`)}`,
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
      const orderDebits: { itemCode: string; lot: string; qty: number }[] = [];
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
        // Lot de l'ARTICLE (une EM par ligne) — repli sur le lot primaire.
        const itemLot = lotByItem.get(ln.ItemCode) ?? lotCode;
        // FIFO simple : on accepte le BL si on a au moins la qté demandée, sinon
        // on patch quand même (le BL ne sera couvert que partiellement, mais lot
        // affecté) — TODO : split ligne si on veut être strict.
        const patch: Record<string, unknown> = { LineNum: ln.LineNum, U_NoLot: itemLot };
        if (whs !== ln.WarehouseCode) patch.WarehouseCode = whs;
        patchLines.push(patch);
        // La ligne entière est désormais attribuée à ce lot → débit de sa quantité.
        orderDebits.push({ itemCode: ln.ItemCode, lot: itemLot, qty: ln.Quantity });
        consumeBudget(budget, ln.ItemCode, whs, ln.Quantity);
      }
      if (patchLines.length > 0) {
        await sap.patch(`Orders(${ord.DocEntry})`, { DocumentLines: patchLines });
        retroPatchCount += patchLines.length;
        retroDebits.push(...orderDebits); // débit seulement après PATCH réussi
        console.log(`[GoodsReceipt] Retro lots du groupe EM ${primary.docNum} → Order #${ord.DocNum} (${patchLines.length} ligne(s))`);
      }
    }
    // Débit registre des ventes à découvert désormais servies par ce lot.
    if (retroDebits.length > 0) {
      try { await debitLots(retroDebits); }
      catch (e) { console.warn("[GoodsReceipt] Débit registre rétro échoué (non-bloquant):", (e as Error).message); }
    }
    console.log(
      `[GoodsReceipt] Propagation rétro : ${orders.length} commande(s) ouverte(s) depuis le ${retroSince} scannée(s), `
      + `${retroPatchCount} ligne(s) ${LOT_PENDING} → lots du groupe EM ${primary.docNum}`,
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
  // Débits registre des composants fabriqués à découvert désormais servis par ce
  // lot (miroir de la retro Orders) — appliqués après PATCH SAP réussi.
  const retroFabDebits: { itemCode: string; lot: string; qty: number }[] = [];
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
        retroFabDebits.push(...exitDebits); // débit après PATCH réussi
        console.log(`[GoodsReceipt] Retro lots du groupe EM ${primary.docNum} → InventoryGenExit #${exit.DocNum} (${patchLines.length} ligne(s))`);
      }
    }
    // Débit registre des composants fabriqués désormais servis par ce lot.
    if (retroFabDebits.length > 0) {
      try { await debitLots(retroFabDebits); }
      catch (e) { console.warn("[GoodsReceipt] Débit registre rétro fabrication échoué (non-bloquant):", (e as Error).message); }
    }

    // Miroir local : FabricationRunLine encore en sentinel sur les items patchés
    // côté SAP, restreint aux runs du jour ("createdAt" >= minuit) — on ne
    // réécrit pas d'anciens runs jamais couverts par une EM.
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
        console.log(`[GoodsReceipt] FabricationRunLine ${itemCode}: ${updated} ligne(s) ${LOT_PENDING} → ${itemLot}`);
      }
    }

    console.log(
      `[GoodsReceipt] Propagation rétro fabrication : ${exits.length} sortie(s) du ${today} scannée(s), `
      + `${retroFabricationCount} ligne(s) ${LOT_PENDING} → lots du groupe EM ${primary.docNum}`,
    );
  } catch (e) {
    console.warn("[GoodsReceipt] Propagation rétro fabrication échouée (non-bloquant):", (e as Error).message);
  }

  // ── VALIDATION AUTO des bons de commande (offres) désormais couverts ──
  // Un bon de commande = Quotation SAP : il ne réserve pas de stock. Quand la
  // marchandise reçue rend TOUS ses articles disponibles, on le passe
  // automatiquement en commande ferme (comme le bouton « Passer en commande »).
  // Garde-fous : jour de départ atteint (on ne convertit pas une précommande
  // future), offre 100 % couverte par le DISPONIBLE SAP (stock − engagements),
  // budget décrémenté en FIFO pour ne pas sur-promettre entre offres, et
  // best-effort (jamais bloquant pour la réception).
  let autoConvertCount = 0;
  try {
    const receivedItems = new Set(createdDocs.map((d) => d.line.itemCode));
    type QLine = { ItemCode?: string; Quantity?: number };
    type QDoc = { DocEntry: number; DocNum: number; DocDueDate: string; Cancelled?: string; DocumentStatus: string; DocumentLines?: QLine[] };
    const quotes = await sap.getAll<QDoc>(
      `Quotations?$orderby=DocEntry asc`
      + `&$select=DocEntry,DocNum,DocDueDate,Cancelled,DocumentStatus,DocumentLines`
      + `&$filter=${encodeURIComponent(`DocDate ge '${retroSince}' and DocumentStatus eq 'bost_Open'`)}`,
      { pageSize: 200 },
    );
    // Offres candidates : ouvertes, non annulées, jour de départ atteint, et
    // touchées par au moins un article reçu (une réception ne valide que ce
    // qu'elle peut plausiblement débloquer).
    const candidates = quotes.filter((q) =>
      q.Cancelled !== "tYES"
      && isDepartureReached(q.DocDueDate)
      && (q.DocumentLines ?? []).some((l) => l.ItemCode && receivedItems.has(l.ItemCode)));

    if (candidates.length > 0) {
      // Disponible SAP (stock − engagements) par article, snapshot après le PDN.
      const codes = [...new Set(candidates.flatMap((q) => (q.DocumentLines ?? []).map((l) => l.ItemCode).filter(Boolean)))] as string[];
      const availByItem = new Map<string, number>();
      for (let i = 0; i < codes.length; i += 20) {
        const chunk = codes.slice(i, i + 20);
        try {
          const or = chunk.map((c) => `ItemCode eq '${c.replace(/'/g, "''")}'`).join(" or ");
          const items = await sap.getAll<{ ItemCode: string; QuantityOnStock?: number; QuantityOrderedByCustomers?: number }>(
            `Items?$select=ItemCode,QuantityOnStock,QuantityOrderedByCustomers&$filter=${encodeURIComponent(`(${or})`)}`,
            { pageSize: 50, maxPages: 2 },
          );
          for (const it of items) availByItem.set(it.ItemCode, (it.QuantityOnStock ?? 0) - (it.QuantityOrderedByCustomers ?? 0));
        } catch { /* lot d'articles en échec → offres de ces articles non converties */ }
      }
      for (const q of candidates) {
        // Besoin par article (une offre peut porter plusieurs lignes d'un article).
        const need = new Map<string, number>();
        for (const l of (q.DocumentLines ?? [])) {
          if (l.ItemCode && l.Quantity && l.Quantity > 0) need.set(l.ItemCode, (need.get(l.ItemCode) ?? 0) + l.Quantity);
        }
        if (need.size === 0) continue;
        // Couverte SEULEMENT si CHAQUE article a assez de disponible restant.
        let covered = true;
        for (const [code, qty] of need) { if ((availByItem.get(code) ?? 0) < qty - 1e-6) { covered = false; break; } }
        if (!covered) continue;
        try {
          const r = await convertQuotationToOrder(q.DocEntry, "auto (réception)");
          // Réserve le disponible pour ne pas sur-promettre une autre offre.
          for (const [code, qty] of need) availByItem.set(code, (availByItem.get(code) ?? 0) - qty);
          autoConvertCount++;
          console.log(`[GoodsReceipt] Bon de commande #${q.DocNum} couvert → Commande #${r.docNum} (validation auto)`);
        } catch (e) {
          console.warn(`[GoodsReceipt] Conversion auto de l'offre #${q.DocNum} échouée (non-bloquant):`, (e as Error).message);
        }
      }
    }
    if (autoConvertCount > 0) console.log(`[GoodsReceipt] Validation auto : ${autoConvertCount} bon(s) de commande → commande(s).`);
  } catch (e) {
    console.warn("[GoodsReceipt] Validation auto des bons de commande échouée (non-bloquant):", (e as Error).message);
  }

  // ── Incrément optimiste local — latence 0 pour le commercial ──
  // ProductStock est en unité d'inventaire (pie), donc on incrémente pieceQty
  // (= colis × ratio), pas packageQuantity.
  try {
    await incrementLocalStock(createdDocs.map((d) => ({
      itemCode: d.line.itemCode,
      quantity: d.line.pieceQty,
      warehouseCode: d.line.warehouseCode,
    })));
  } catch (e) {
    console.warn("[GoodsReceipt] incrementLocalStock échoué (non-bloquant):", (e as Error).message);
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
    // Échec PARTIEL : lignes NON créées (à ressaisir dans une nouvelle entrée).
    partialError: createError ?? undefined,
    failedLines: failedLines.length > 0 ? failedLines : undefined,
    retroPatchedLines: retroPatchCount,        // BL ouverts du jour repris sur les lots du groupe
    retroFabricationLines: retroFabricationCount, // sorties fabrication du jour reprises sur les lots du groupe
    autoConvertedBonsCommande: autoConvertCount,  // bons de commande couverts → commandes fermes (auto)
    cardCode,
    db: process.env.SAP_B1_COMPANY_DB,
    lines: createdDocs.map((d) => ({
      itemCode: d.line.itemCode,
      packageQuantity: d.line.packageQuantity,
      pieceQuantity: d.line.pieceQty,
      ratio: d.line.ratio,
      warehouse: d.line.warehouseCode,
      lot: d.lot,
      docNum: d.docNum,
      docEntry: d.docEntry,
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

  // L'AGRÉEUR « pur » (sans rôle de gestion) ne doit PAS voir les PRIX des entrées
  // marchandises. On masque les montants côté serveur (défense en profondeur —
  // l'UI les cache aussi) et on interdit l'édition des prix (editable=false). La
  // préparation / l'administration conserve la vision et l'édition complètes.
  const priceBlind = (await isAgreeur(session)) && !(await requirePreparateurOrAdmin(session));

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

    // ── Groupes « une EM par ligne » (lib/emGroup) : DocNum → n° du groupe ──
    const groups = await getEmGroups();

    // ── Notes qualité (étoiles) par (article × lot) — une note par PRODUIT par
    //    EM, posée par l'agréeur. Lecture groupée pour l'affichage/édition. ──
    const notePairs = listed.flatMap((d) => (d.DocumentLines || []).map((l) => ({ itemCode: l.ItemCode, lot: `EM${d.DocNum}` })));
    const lotNotes = await getLotNotesForPairs(notePairs);

    const mapped = listed.map((d) => {
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
          // L'agréeur « price blind » ne modifie jamais les prix → editable=false.
          editable: !priceBlind && d.DocumentStatus !== "bost_Close" && !isCancellation && !cancelled,
          total: priceBlind ? 0 : totalTTC,        // rétro-compat : « total » = TTC
          totalTTC: priceBlind ? 0 : totalTTC,
          totalHT: priceBlind ? 0 : totalHT,
          totalTVA: priceBlind ? 0 : totalTVA,
          comments: d.Comments ?? "",
          lineCount: lines.length,
          lines: lines.map((l) => {
            const p = pMap.get(l.ItemCode);
            const ratio = (p?.salesQtyPerPackUnit && p.salesQtyPerPackUnit > 1) ? p.salesQtyPerPackUnit : 1;
            return {
              lineNum: l.LineNum,
              // EM SAP qui PORTE cette ligne (avec « une EM par ligne », chaque
              // ligne a la sienne — sur une EM historique, celle du document).
              docEntry: d.DocEntry,
              docNum: d.DocNum,
              lot: `EM${d.DocNum}`,
              itemCode: l.ItemCode,
              itemName: l.ItemDescription || p?.itemName || l.ItemCode,
              pieceQuantity: l.Quantity,
              packageQuantity: l.PackageQuantity ?? (ratio > 1 ? l.Quantity / ratio : l.Quantity),
              warehouse: l.WarehouseCode,
              price: priceBlind ? null : (l.Price ?? null),
              lineTotal: priceBlind ? null : (l.LineTotal ?? null),
              taxPercent: priceBlind ? null : (l.TaxPercentagePerRow ?? null),
              // Note qualité (étoiles) de l'agréeur pour ce PRODUIT sur SON lot/EM.
              rating: lotNotes.get(`${l.ItemCode}::EM${d.DocNum}`) ?? null,
              // Désignation décomposée (catalogue local)
              uPays: p?.uPays ?? null,
              uMarque: p?.uMarque ?? null,
              uCondi: p?.uCondi ?? null,
              frgnName: p?.frgnName ?? null,
            };
          }),
        };
      });

    // ── REGROUPEMENT « une EM par ligne » : les EM d'un même groupe s'affichent
    //    en UNE SEULE entrée (n° du groupe = EM primaire), le n° d'EM propre à
    //    chaque ligne restant porté par la ligne. Les documents d'annulation SAP
    //    ne sont jamais membres d'un groupe → ils restent affichés seuls. ──
    type MappedDoc = (typeof mapped)[number];
    type OutLine = MappedDoc["lines"][number] & { cancelled?: boolean };
    const byGroup = new Map<number, MappedDoc[]>();
    const groupOrder: number[] = [];
    for (const m of mapped) {
      const g = groups.get(m.docNum) ?? m.docNum;
      if (!byGroup.has(g)) { byGroup.set(g, []); groupOrder.push(g); }
      byGroup.get(g)!.push(m);
    }
    const docsOut = groupOrder.map((g) => {
      const members = byGroup.get(g)!;
      if (members.length === 1) {
        const m = members[0];
        return { ...m, grouped: false, docNums: [m.docNum], docEntries: [m.docEntry], lots: [m.lot], lines: m.lines as OutLine[] };
      }
      // Membres par DocNum croissant = ordre de saisie des lignes. L'EM primaire
      // (n° du groupe) peut être hors fenêtre de pagination → repli sur la 1re.
      const sorted = [...members].sort((a, b) => a.docNum - b.docNum);
      const primary = sorted.find((m) => m.docNum === g) ?? sorted[0];
      // Cumuls sur les membres « vivants » uniquement (une EM du groupe annulée
      // ne compte plus) — si tout est annulé, on garde les montants pour trace.
      const live = sorted.filter((m) => !m.cancelled && !m.isCancellation);
      const base = live.length > 0 ? live : sorted;
      const sum = (f: (m: MappedDoc) => number) => Math.round(base.reduce((s, m) => s + f(m), 0) * 100) / 100;
      const cancelled = sorted.every((m) => m.cancelled);
      return {
        ...primary,
        grouped: true,
        docNums: sorted.map((m) => m.docNum),
        docEntries: sorted.map((m) => m.docEntry),
        lots: sorted.map((m) => m.lot),
        cancelled,
        cancelledByDocNum: cancelled ? primary.cancelledByDocNum : null,
        editable: !cancelled && sorted.some((m) => m.editable),
        total: sum((m) => m.total),
        totalTTC: sum((m) => m.totalTTC),
        totalHT: sum((m) => m.totalHT),
        totalTVA: sum((m) => m.totalTVA),
        lineCount: sorted.reduce((s, m) => s + m.lineCount, 0),
        // Chaque ligne garde SON EM (docEntry/docNum/lot) + son état d'annulation.
        lines: sorted.flatMap((m) => m.lines.map((l) => ({ ...l, cancelled: m.cancelled || m.isCancellation }))) as OutLine[],
      };
    });

    return NextResponse.json({
      db: process.env.SAP_B1_COMPANY_DB,
      count: docsOut.length,
      docs: docsOut,
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
 * Body : { docEntry: number, docEntries?: number[], numAtCard: string }
 *   - `docEntries` (groupe « une EM par ligne ») : le n° de BL est posé sur
 *     TOUTES les EM SAP du groupe — elles partagent la même référence.
 */
export async function PATCH(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

  let body: { docEntry?: number; docEntries?: number[]; numAtCard?: string };
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: "JSON invalide" }, { status: 400 }); }

  const docEntry = Number(body.docEntry);
  if (!docEntry || Number.isNaN(docEntry)) {
    return NextResponse.json({ error: "docEntry requis" }, { status: 400 });
  }
  const entries = Array.isArray(body.docEntries) && body.docEntries.length > 0
    ? Array.from(new Set(body.docEntries.map(Number).filter((n) => Number.isFinite(n) && n > 0)))
    : [docEntry];
  if (!entries.includes(docEntry)) entries.unshift(docEntry);
  const numAtCard = (body.numAtCard ?? "").trim();

  try {
    for (const de of entries) {
      await sap.patch(`PurchaseDeliveryNotes(${de})`, { NumAtCard: numAtCard });
    }
    return NextResponse.json({ ok: true, numAtCard, updated: entries.length });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
