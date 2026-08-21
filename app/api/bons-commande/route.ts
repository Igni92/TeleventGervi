import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { sap } from "@/lib/sapb1";
import { colisInfo } from "@/lib/colis";
import { getLotMaps, resolveLotForSegment, LOT_PENDING } from "@/lib/lotResolver";
import { mirrorCreatedOrder, type CreatedOrderForMirror } from "@/lib/sapMirror";
import { getEmAffects } from "@/lib/emAffect";
import { getItemStock } from "@/lib/lotStock";
import { buildLotCandidates, type LotCandidate } from "@/lib/lotCandidates";
import { listBonCommandeDocEntries, setDeliveryBonCommande } from "@/lib/inventory";
import { debitLots, isRealLot } from "@/lib/lotLedger";
import { isLotPending, familyOfLot, LOT_FAMILY_PREFIX } from "@/lib/gervifrais-calc";
import { FRUIT_FAMILIES } from "@/lib/familles";
import { isDepartureReached } from "@/lib/livraison";

export const dynamic = "force-dynamic";
// Cet écran interroge SAP (offres + commandes + calibre + cartes de lots). Sans
// plafond explicite, un SAP lent faisait dépasser la durée par défaut de la
// fonction et la requête mourait SANS réponse → l'écran restait en « chargement »
// indéfiniment. Avec un plafond assumé, le dépassement remonte une erreur que le
// front peut afficher.
export const maxDuration = 60;

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
  Price?: number;
  LineTotal?: number;
};
type SapOrderDoc = {
  DocEntry: number;
  DocNum: number;
  DocDate?: string;
  DocDueDate?: string;
  CardCode: string;
  CardName?: string;
  NumAtCard?: string;
  DocumentStatus?: string;
  Cancelled?: string;
  DocumentLines?: SapLine[];
};

// Une ligne « en attente » = vide, EM_PENDING (à découvert générique) OU un
// sentinel famille EM_FAM:<fruit> (produit à préciser). Toutes gardent la
// commande dans l'onglet — cf. lib/gervifrais-calc.isLotPending.
const isPending = (lot: string | undefined | null) => isLotPending(lot);

// Familles de fruits connues (clé → libellé) pour valider/afficher un tag « produit ».
const FAMILY_LABEL = new Map(FRUIT_FAMILIES.map((f) => [f.key, f.label]));

// ── OFFRES CLIENT (Quotations SAP) ──────────────────────────────
// Une précommande crée une OFFRE CLIENT SAP (Quotation), pas une commande
// engagée. Elle s'affiche ici en attente d'être « passée en commande » au jour
// de départ (POST action=convert → crée la Commande client + marque « lots à
// affecter »). Objet SAP oQuotations = 23 (pour la conversion base→cible).
const QUOTATION_OBJTYPE = 23;

// Une ligne préparable (offre OU commande) : article fusionné + son lot courant
// et les lots candidats. Partagée entre l'affectation sur l'OFFRE (avant passage
// en commande) et sur la COMMANDE (file d'affectation classique).
interface PrepLine {
  itemCode: string; itemName: string; quantity: number; colis: number;
  warehouse: string | null; marque: string | null; condt: string | null; pays: string | null;
  variete: string | null; uvc: string | null; calibre: string | null;
  /** Prix unitaire HT (LineTotal SAP ÷ quantité) et total HT — null si indisponible. */
  price: number | null; lineTotal: number | null;
  lot: string; pending: boolean; candidates: LotCandidate[]; suggested: string | null;
  familyTarget: { key: string; label: string } | null;
}
type OffreDoc = {
  docEntry: number; docNum: number; cardCode: string; cardName: string;
  clientType: string | null; dueDate: string | null; docDate: string | null;
  numAtCard: string | null;
  /** true = jour de départ atteint → à passer en commande (pastille). */
  due: boolean; lineCount: number; colis: number;
  /** Nb de lignes encore « en attente » de lot (à affecter avant de passer). */
  pendingCount: number;
  lines: PrepLine[];
};

/** Ligne d'un document miroir (SapQuotationLine / SapOrderLine). */
type MirrorLine = {
  lineNum: number; itemCode: string | null; itemDescription: string | null;
  quantity: number; warehouseCode: string | null; uNoLot: string | null; lineTotal: number;
};
/** En-tête d'un document miroir (offre ou commande) + ses lignes. */
type MirrorDoc = {
  docEntry: number; docNum: number | null; docDate: Date; docDueDate: Date | null;
  cardCode: string; cardName: string | null; numAtCard?: string | null; cancelled: boolean;
  lines: MirrorLine[];
};

/**
 * Adapte un document du MIROIR (offre/commande + lignes) au format SapOrderDoc
 * attendu par buildPrepLines — plus AUCUN appel SAP en lecture (chantier C).
 * Le lot par ligne (uNoLot) et la date de départ (docDueDate) sont désormais
 * miroités et tenus frais par le cron + le write-through des écritures.
 */
function mirrorToDoc(d: MirrorDoc, status: "bost_Open" | "bost_Close"): SapOrderDoc {
  return {
    DocEntry: d.docEntry, DocNum: d.docNum ?? 0,
    DocDate: d.docDate.toISOString(),
    DocDueDate: d.docDueDate ? d.docDueDate.toISOString() : undefined,
    CardCode: d.cardCode, CardName: d.cardName ?? undefined,
    NumAtCard: d.numAtCard ?? undefined,
    DocumentStatus: status, Cancelled: d.cancelled ? "tYES" : "tNO",
    DocumentLines: d.lines
      .slice()
      .sort((a, b) => a.lineNum - b.lineNum)
      .map((l) => ({
        LineNum: l.lineNum, ItemCode: l.itemCode ?? "", ItemDescription: l.itemDescription ?? undefined,
        Quantity: l.quantity, WarehouseCode: l.warehouseCode ?? undefined,
        U_NoLot: l.uNoLot ?? undefined, LineTotal: l.lineTotal,
      })),
  };
}

type ProductInfo = {
  itemName: string; salesUnit: string | null; salesUnitWeight: number | null;
  salesQtyPerPackUnit: number | null; uMarque: string | null; uCondi: string | null;
  uPays: string | null; uUvc: string | null; frgnName: string | null;
};

export async function GET() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

  try {
    // ── Offres (SapQuotation) + commandes marquées (SapOrder) : TOUT depuis le
    //    MIROIR local — plus AUCUN appel SAP en lecture (chantier C). Le lot par
    //    ligne (uNoLot) et la date de départ (docDueDate) sont miroités (cron) et
    //    tenus frais IMMÉDIATEMENT par le write-through des écritures (PATCH/POST).
    const [marks, offresMirror] = await Promise.all([
      listBonCommandeDocEntries(),
      prisma.sapQuotation.findMany({
        where: { documentStatus: "O", cancelled: false },
        orderBy: { docDueDate: "asc" },
        include: { lines: true },
      }),
    ]);
    const markInfo = new Map(marks.map((m) => [m.docEntry, m]));
    const docEntries = marks.map((m) => m.docEntry);

    const ordersMirror = docEntries.length
      ? await prisma.sapOrder.findMany({
          where: { docEntry: { in: docEntries }, cancelled: false },
          include: { lines: true },
        })
      : [];

    const offresRaw: SapOrderDoc[] = offresMirror.map((q) => mirrorToDoc(q, "bost_Open"));
    // Une commande marquée reste dans la file tant qu'elle a des lignes en attente
    // (filtré plus bas sur pendingCount) → statut « open » par défaut.
    const live: SapOrderDoc[] = ordersMirror.map((o) => mirrorToDoc(o, "bost_Open"));

    // Union des articles (offres + commandes) → produits (dont calibre), stock, lots.
    const allDocs = [...offresRaw, ...live];
    const itemCodes = Array.from(
      new Set(allDocs.flatMap((d) => (d.DocumentLines ?? []).map((l) => l.ItemCode)).filter(Boolean)),
    );
    // Segment client par CardCode (union offres + commandes).
    const cardCodes = Array.from(new Set(allDocs.map((d) => d.CardCode)));

    // ── Référentiels LOCAUX EN PARALLÈLE ──
    // Produits (DB, calibre = uCalibre miroité → fini l'appel SAP Items), segments
    // client (DB), cartes de lots (miroir), affectations EM et stock physique.
    const [prods, clients, maps, affects, stock] = await Promise.all([
      itemCodes.length
        ? prisma.product.findMany({
            where: { itemCode: { in: itemCodes } },
            select: { itemCode: true, itemName: true, salesUnit: true, salesUnitWeight: true,
                      salesQtyPerPackUnit: true, uMarque: true, uCondi: true, uPays: true, uUvc: true,
                      frgnName: true, uCalibre: true },
          })
        : Promise.resolve([]),
      cardCodes.length
        ? prisma.client.findMany({ where: { code: { in: cardCodes } }, select: { code: true, type: true } })
        : Promise.resolve([]),
      getLotMaps(), getEmAffects(), getItemStock(itemCodes),
    ]);

    const pMap = new Map<string, ProductInfo>();
    const calibreByItem = new Map<string, string>();
    for (const p of prods) {
      pMap.set(p.itemCode, p);
      if (p.uCalibre) calibreByItem.set(p.itemCode, p.uCalibre.trim());
    }
    const typeByCard = new Map<string, string | null>();
    for (const c of clients) typeByCard.set(c.code, c.type);
    const unitsPerColis = (code: string) => {
      const p = pMap.get(code);
      return p ? colisInfo(p).unitsPerColis || 1 : 1;
    };
    const segmentOf = (cardCode: string) => (typeByCard.get(cardCode) ?? "").trim().toUpperCase() || null;
    // Libellé lisible d'une EM (au survol) : « Reçu le jj/mm/aaaa · Fournisseur ».
    const emLabel = (dn: number): string => {
      const meta = maps.docMeta.get(dn);
      const parts: string[] = [`EM ${dn}`];
      if (meta?.date) {
        const [y, m, day] = meta.date.split("-");
        if (day && m && y) parts.push(`reçu le ${day}/${m}/${y}`);
      }
      if (meta?.supplier) parts.push(meta.supplier);
      return parts.join(" · ");
    };
    // Lots candidats d'un article : liste COURTE et FIABLE (cf. lib/lotCandidates).
    // On ne propose qu'une EM par (entrepôt × segment), la plus récente, et
    // seulement si l'entrepôt de réception porte du stock physique — le stock par
    // lot n'existe pas dans ce SAP (maille article × entrepôt). `orderWarehouse`
    // = magasin de la ligne (priorité douce d'affichage).
    const candidatesFor = (itemCode: string, segment: string | null, orderWarehouse: string | null) =>
      buildLotCandidates({
        itemCode,
        orderWarehouse,
        segment,
        emDocs: maps.byItemList.get(itemCode) ?? [],
        warehouseOf: (dn) => maps.whsOfItemDoc.get(`${itemCode}|${dn}`) ?? null,
        affectOf: (dn) => affects.get(dn) ?? "TOUS",
        metaOf: (dn) => {
          const meta = maps.docMeta.get(dn);
          return { date: meta?.date ?? null, supplier: meta?.supplier ?? null, label: emLabel(dn) };
        },
        stockInWarehouse: (whs) => (whs ? (stock.byItemWhs.get(`${itemCode}|${whs}`) ?? 0) : 0),
        itemTotalStock: stock.byItem.get(itemCode) ?? 0,
        suggestedLot: resolveLotForSegment(maps, affects, itemCode, undefined, segment).lot,
      });

    // Fusion par article des lignes d'un document (offre OU commande) : le lot est
    // le même sur toutes les lignes d'un article (affectées ensemble). « pending »
    // = au moins une ligne EM_PENDING. PARTAGÉ offre/commande.
    const buildPrepLines = (docLines: SapLine[], segment: string | null): { lines: PrepLine[]; pendingCount: number; colis: number } => {
      const byItem = new Map<string, { itemCode: string; itemName: string; quantity: number; colisRaw: number;
        warehouse: string | null; marque: string | null; condt: string | null; pays: string | null;
        variete: string | null; uvc: string | null; calibre: string | null; lineTotalRaw: number;
        lot: string; pending: boolean; familyKey: string | null }>();
      for (const l of docLines) {
        const p = pMap.get(l.ItemCode);
        const qty = l.Quantity ?? 0;
        const g = byItem.get(l.ItemCode);
        const rawLot = (l.U_NoLot ?? "").trim();
        const linePending = isPending(l.U_NoLot);
        // Tag « produit / famille » (EM_FAM:<fruit>) porté par la ligne, si connu.
        const famKey = familyOfLot(rawLot);
        const famValid = famKey && FAMILY_LABEL.has(famKey) ? famKey : null;
        if (!g) {
          byItem.set(l.ItemCode, {
            itemCode: l.ItemCode,
            itemName: l.ItemDescription || p?.itemName || l.ItemCode,
            quantity: qty,
            colisRaw: qty / (unitsPerColis(l.ItemCode) || 1),
            warehouse: l.WarehouseCode ?? null,
            marque: p?.uMarque ?? null, condt: p?.uCondi ?? null, pays: p?.uPays ?? null,
            variete: p?.frgnName ?? null, uvc: p?.uUvc ?? null, calibre: calibreByItem.get(l.ItemCode) ?? null,
            lineTotalRaw: l.LineTotal ?? 0,
            // On PRÉSERVE le sentinel famille tel quel (rappel affiché) ; sinon
            // EM_PENDING générique pour une ligne à découvert, ou le vrai lot.
            lot: linePending ? (famValid ? rawLot : LOT_PENDING) : rawLot,
            pending: linePending,
            familyKey: famValid,
          });
        } else {
          g.quantity += qty;
          g.colisRaw += qty / (unitsPerColis(l.ItemCode) || 1);
          g.lineTotalRaw += l.LineTotal ?? 0;
          if (linePending) {
            g.pending = true;
            // Une famille portée par n'importe quelle ligne de l'article prime sur
            // le « à découvert » générique (elle porte l'intention à afficher).
            if (famValid && !g.familyKey) { g.familyKey = famValid; g.lot = rawLot; }
            else if (!g.familyKey) { g.lot = LOT_PENDING; }
          }
        }
      }
      const lines: PrepLine[] = [...byItem.values()].map((l) => {
        const { candidates, suggested } = candidatesFor(l.itemCode, segment, l.warehouse);
        return {
          itemCode: l.itemCode, itemName: l.itemName,
          quantity: l.quantity, colis: Math.round(l.colisRaw * 10) / 10,
          warehouse: l.warehouse, marque: l.marque, condt: l.condt, pays: l.pays,
          variete: l.variete, uvc: l.uvc, calibre: l.calibre,
          lineTotal: Math.round(l.lineTotalRaw * 100) / 100,
          price: l.quantity > 0 ? Math.round((l.lineTotalRaw / l.quantity) * 100) / 100 : null,
          lot: l.lot, pending: l.pending, candidates, suggested,
          familyTarget: l.familyKey ? { key: l.familyKey, label: FAMILY_LABEL.get(l.familyKey)! } : null,
        };
      });
      return {
        lines,
        pendingCount: lines.filter((l) => l.pending).length,
        colis: Math.round(lines.reduce((s, l) => s + l.colis, 0) * 10) / 10,
      };
    };

    // ── OFFRES : lignes AVEC lots/candidats (affectation AVANT passage en commande) ──
    const offres: OffreDoc[] = offresRaw
      .map((d) => {
        const dueDate = d.DocDueDate ? d.DocDueDate.slice(0, 10) : null;
        const { lines, pendingCount, colis } = buildPrepLines(d.DocumentLines ?? [], segmentOf(d.CardCode));
        return {
          docEntry: d.DocEntry, docNum: d.DocNum,
          cardCode: d.CardCode, cardName: d.CardName ?? d.CardCode,
          clientType: segmentOf(d.CardCode),
          dueDate, docDate: d.DocDate ?? null,
          numAtCard: (d.NumAtCard ?? "").trim() || null,
          due: dueDate ? isDepartureReached(dueDate) : false,
          lineCount: lines.length, colis, pendingCount, lines,
        };
      })
      // À passer (jour de départ atteint) en tête, puis par date de livraison.
      .sort((a, b) => Number(b.due) - Number(a.due) || (a.dueDate ?? "").localeCompare(b.dueDate ?? ""));

    // ── COMMANDES marquées « lots à affecter » ──
    const docs = live.map((d) => {
      const segment = segmentOf(d.CardCode);
      const { lines, pendingCount } = buildPrepLines(d.DocumentLines ?? [], segment);
      const mark = markInfo.get(d.DocEntry);
      return {
        docEntry: d.DocEntry, docNum: d.DocNum,
        cardCode: d.CardCode, cardName: d.CardName ?? d.CardCode,
        clientType: segment,
        dueDate: d.DocDueDate ?? null, docDate: d.DocDate ?? null,
        open: d.DocumentStatus !== "bost_Close",
        markedBy: mark?.by ?? null, markedAt: mark?.at ?? null,
        pendingCount, lines,
      };
    })
    // Les commandes entièrement affectées ne devraient plus être marquées, mais on
    // filtre par sécurité (une marque résiduelle ne pollue pas l'onglet).
    .filter((d) => d.pendingCount > 0)
    // Précommandes d'abord (livraison la plus proche en tête).
    .sort((a, b) => (a.dueDate ?? "").localeCompare(b.dueDate ?? ""));

    return NextResponse.json({ ok: true, offres, docs, pending: LOT_PENDING });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}

/**
 * PATCH — affecte un lot à TOUTES les lignes d'un article d'un document.
 * Body : { docEntry: number, itemCode: string, lot: string, target?: "offre" | "commande" }
 *   • target "commande" (défaut) → COMMANDE (Order) de la file d'affectation ;
 *   • target "offre"             → OFFRE (Quotation) : affecter les lots AVANT de
 *                                  passer en commande — la commande créée héritera
 *                                  du lot (BaseType 23 recopie U_NoLot).
 * `lot` vaut :
 *   • "EM<DocNum>"        → arrivage choisi (résolu) ;
 *   • "EM_PENDING"        → à découvert générique (réécrit auto à la réception) ;
 *   • "EM_FAM:<fruit>"    → produit à préciser (rappel — PAS d'auto-affectation),
 *                           la clé de fruit doit être connue (cf. FRUIT_FAMILIES).
 * Les deux derniers laissent la ligne « en attente ».
 */
export async function PATCH(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

  let body: { docEntry?: number; itemCode?: string; lot?: string; target?: string };
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: "JSON invalide" }, { status: 400 }); }

  const docEntry = Number(body.docEntry);
  const itemCode = (body.itemCode ?? "").trim();
  const lot = (body.lot ?? "").trim();
  // Document cible : OFFRE (Quotation) ou COMMANDE (Order, défaut).
  const isOffre = body.target === "offre";
  const entity = isOffre ? "Quotations" : "Orders";
  if (!Number.isInteger(docEntry) || docEntry <= 0) return NextResponse.json({ error: "docEntry invalide" }, { status: 400 });
  if (!itemCode) return NextResponse.json({ error: "itemCode requis" }, { status: 400 });
  if (!lot) return NextResponse.json({ error: "lot requis" }, { status: 400 });
  // Tag « produit » : la clé de fruit doit exister (garde-fou anti-sentinel bidon
  // écrit dans SAP). Les vrais lots EM<DocNum> et EM_PENDING passent tels quels.
  if (lot.startsWith(LOT_FAMILY_PREFIX)) {
    const key = familyOfLot(lot);
    if (!key || !FAMILY_LABEL.has(key)) {
      return NextResponse.json({ error: `Fruit inconnu pour le tag « ${lot} »` }, { status: 400 });
    }
  }

  try {
    const doc = await sap.get<SapOrderDoc>(
      `${entity}(${docEntry})?$select=DocEntry,DocNum,DocumentLines`,
    );
    const allLines = doc.DocumentLines ?? [];
    const patchLines = allLines
      .filter((l) => l.ItemCode === itemCode && l.LineNum != null)
      .map((l) => ({ LineNum: l.LineNum, U_NoLot: lot }));
    if (patchLines.length === 0) {
      return NextResponse.json({ error: `Aucune ligne « ${itemCode} » sur ${isOffre ? "l'offre" : "la commande"}` }, { status: 404 });
    }
    // Registre des lots — DÉBIT à la PREMIÈRE affectation d'un vrai lot sur une
    // COMMANDE : si les lignes de cet article étaient toutes « en attente » avant ce
    // PATCH et qu'on pose un vrai EM<DocNum>, la marchandise est consommée sur ce lot.
    // Une simple RÉaffectation (lignes déjà résolues) ne re-débite pas. Calculé AVANT
    // le PATCH.
    //
    // ⚠️ PAS de débit sur une OFFRE : le lot posé sur l'offre est hérité par la
    // commande à la conversion (BaseType 23). Débiter ici risquerait un DOUBLE débit
    // si la reprise du U_NoLot échouait (la commande retomberait dans la file et
    // serait re-affectée → re-débit). Le débit reste porté par la COMMANDE (comme
    // aujourd'hui pour les offres déjà résolues, qui ne débitent pas non plus).
    const itemLines = allLines.filter((l) => l.ItemCode === itemCode);
    const wasAllPending = itemLines.every((l) => isPending(l.U_NoLot));
    const soldQty = itemLines.reduce((s, l) => s + (l.Quantity ?? 0), 0);

    await sap.patch(`${entity}(${docEntry})`, { DocumentLines: patchLines });

    // ── WRITE-THROUGH miroir : refléter le lot posé sur les lignes de cet article
    // IMMÉDIATEMENT (le GET lit le miroir). Sans ça, la ligne resterait « en
    // attente » à l'écran jusqu'à la prochaine synchro (≤10 min). Best-effort.
    try {
      const lineTable = isOffre ? "SapQuotationLine" : "SapOrderLine";
      await prisma.$executeRawUnsafe(
        `UPDATE "${lineTable}" SET "uNoLot" = $1 WHERE "docEntry" = $2 AND "itemCode" = $3`,
        lot, docEntry, itemCode,
      );
    } catch (e) {
      console.warn("[BonCommande] write-through lot miroir échoué (rattrapé à la synchro):", (e as Error).message);
    }

    if (!isOffre && wasAllPending && isRealLot(lot) && soldQty > 0) {
      try {
        await debitLots([{ itemCode, lot, qty: soldQty }]);
      } catch (e) {
        console.warn(`[BonCommande] Débit registre lot ${lot} échoué (non-bloquant):`, (e as Error).message);
      }
    }

    // Reste-t-il des lignes en attente après cette affectation ?
    const stillPending = allLines.some((l) => {
      const effLot = l.ItemCode === itemCode ? lot : l.U_NoLot;
      return isPending(effLot);
    });
    // Une COMMANDE entièrement affectée sort de l'onglet (on lève la marque). Une
    // OFFRE n'est jamais marquée : elle reste listée jusqu'à son passage en commande.
    if (!stillPending && !isOffre) {
      await setDeliveryBonCommande(docEntry, false, "").catch(() => {});
    }
    return NextResponse.json({ ok: true, docEntry, itemCode, lot, cleared: !stillPending });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error(`[BonCommande] PATCH lot ${itemCode}@${entity}(${docEntry}) échoué:`, message);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

/**
 * POST — actions sur une OFFRE CLIENT (Quotation SAP). `docEntry` = celui de l'offre.
 *   • action:"convert" → « Passer en commande » : crée la Commande client (Order)
 *     à partir de l'offre (référence base→cible BaseType 23 — SAP recopie
 *     article/qté/prix/UDF dont U_NoLot=EM_PENDING) et clôture l'offre. La
 *     commande créée est marquée « lots à affecter » et rejoint la file.
 *   • action:"update" → modifie la date de livraison (dueDate) et/ou le n° de
 *     commande client (numAtCard) de l'offre.
 *   • action:"delete" → supprime l'offre (Quotation) dans SAP.
 */
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

  let body: { action?: string; docEntry?: number; dueDate?: string; numAtCard?: string };
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: "JSON invalide" }, { status: 400 }); }

  const docEntry = Number(body.docEntry);
  if (!Number.isInteger(docEntry) || docEntry <= 0) return NextResponse.json({ error: "docEntry invalide" }, { status: 400 });

  // ── Retirer une COMMANDE de la liste (lever le marqueur) ─────
  // Cas des commandes FACTURÉES / clôturées qu'on ne peut plus solder par
  // l'affectation de lots (SAP refuse le PATCH d'une commande close) : sans ça
  // elles restent épinglées à vie dans l'onglet. On lève simplement le marqueur
  // `livcommande:<docEntry>` (AppSetting) → la commande sort de l'onglet.
  // ⚠️ AUCUNE modification SAP : la commande ET sa facture ne sont PAS touchées.
  if (body.action === "unmark") {
    try {
      const by = session.user?.name?.trim() || session.user?.email || "";
      await setDeliveryBonCommande(docEntry, false, by);
      console.log(`[BonCommande] Commande docEntry ${docEntry} retirée de la liste (marqueur levé) par ${by || "?"}.`);
      return NextResponse.json({ ok: true, unmarked: true, docEntry });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      console.error(`[BonCommande] Retrait commande ${docEntry} échoué:`, message);
      return NextResponse.json({ ok: false, error: message }, { status: 500 });
    }
  }

  // ── Supprimer une offre ──────────────────────────────────────
  // ⚠️ SAP n'autorise pas DELETE sur un devis (« action not supported for this
  // object »). On l'ANNULE via l'action Service Layer `Cancel` ; à défaut on la
  // CLÔTURE (`Close`). Dans les deux cas l'offre quitte l'onglet (le GET ne liste
  // que les devis ouverts ET non annulés).
  if (body.action === "delete") {
    // Les actions SL (Cancel/Close) sont des POST sans corps sur Quotations(id)/Action.
    const runAction = (action: "Cancel" | "Close") => sap.post(`Quotations(${docEntry})/${action}`, null);
    // Write-through miroir : l'offre quitte la liste tout de suite (le GET filtre
    // documentStatus='O' et cancelled=false). Best-effort.
    const markQuoteGone = (data: { cancelled?: boolean; documentStatus?: string }) =>
      prisma.sapQuotation.updateMany({ where: { docEntry }, data: { ...data, syncedAt: new Date() } })
        .catch((e) => console.warn("[BonCommande] write-through suppression offre échoué:", (e as Error).message));
    try {
      await runAction("Cancel");
      await markQuoteGone({ cancelled: true });
      console.log(`[BonCommande] Offre docEntry ${docEntry} annulée (Cancel).`);
      return NextResponse.json({ ok: true, deleted: true, method: "cancel", docEntry });
    } catch (eCancel) {
      console.warn(`[BonCommande] Cancel offre ${docEntry} échoué, repli Close:`, (eCancel as Error).message);
      try {
        await runAction("Close");
        await markQuoteGone({ documentStatus: "C" });
        console.log(`[BonCommande] Offre docEntry ${docEntry} clôturée (Close).`);
        return NextResponse.json({ ok: true, deleted: true, method: "close", docEntry });
      } catch (eClose) {
        const message = eClose instanceof Error ? eClose.message : String(eClose);
        console.error(`[BonCommande] Annulation offre ${docEntry} échouée (Cancel+Close):`, message);
        return NextResponse.json({ ok: false, error: message }, { status: 500 });
      }
    }
  }

  // ── Modifier date de livraison et/ou n° de commande ──────────
  if (body.action === "update") {
    const patch: Record<string, unknown> = {};
    if (body.dueDate !== undefined) {
      const d = (body.dueDate ?? "").slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return NextResponse.json({ error: "Date de livraison invalide (YYYY-MM-DD attendu)." }, { status: 400 });
      patch.DocDueDate = d;
    }
    if (body.numAtCard !== undefined) {
      // Chaîne vide autorisée = effacer le n° de commande.
      patch.NumAtCard = String(body.numAtCard).trim().slice(0, 100);
    }
    if (Object.keys(patch).length === 0) return NextResponse.json({ error: "Rien à modifier (dueDate ou numAtCard requis)." }, { status: 400 });
    try {
      await sap.patch(`Quotations(${docEntry})`, patch);
      // Write-through miroir : date de départ / n° de commande à jour tout de suite.
      try {
        await prisma.sapQuotation.updateMany({
          where: { docEntry },
          data: {
            ...(patch.DocDueDate !== undefined ? { docDueDate: new Date(String(patch.DocDueDate)) } : {}),
            ...(patch.NumAtCard !== undefined ? { numAtCard: String(patch.NumAtCard).trim() || null } : {}),
            syncedAt: new Date(),
          },
        });
      } catch (e) {
        console.warn("[BonCommande] write-through update offre échoué (rattrapé à la synchro):", (e as Error).message);
      }
      console.log(`[BonCommande] Offre docEntry ${docEntry} mise à jour:`, Object.keys(patch).join(", "));
      return NextResponse.json({ ok: true, docEntry, ...patch });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      console.error(`[BonCommande] Mise à jour offre ${docEntry} échouée:`, message);
      return NextResponse.json({ ok: false, error: message }, { status: 500 });
    }
  }

  // ── Passer en commande (conversion offre → commande) ─────────
  if (body.action !== "convert") return NextResponse.json({ error: "Action inconnue" }, { status: 400 });

  try {
    // Charge l'offre (statut + lignes) pour bâtir la conversion base→cible.
    const quote = await sap.get<SapOrderDoc>(
      `Quotations(${docEntry})?$select=DocEntry,DocNum,CardCode,DocDueDate,NumAtCard,DocumentStatus,Cancelled,DocumentLines`,
    );
    if (quote.Cancelled === "tYES") return NextResponse.json({ error: "Offre annulée — conversion impossible." }, { status: 409 });
    if (quote.DocumentStatus === "bost_Close") return NextResponse.json({ error: "Offre déjà passée en commande." }, { status: 409 });
    const lines = (quote.DocumentLines ?? []).filter((l) => l.LineNum != null);
    if (lines.length === 0) return NextResponse.json({ error: "Offre sans ligne." }, { status: 400 });

    // Conversion : chaque ligne de la commande référence la ligne d'offre
    // (BaseType 23). SAP recopie article/qté/prix/UDF (dont U_NoLot=EM_PENDING).
    const orderPayload: Record<string, unknown> = {
      CardCode: quote.CardCode,
      DocDueDate: quote.DocDueDate,
      DocumentLines: lines.map((l) => ({
        BaseType: QUOTATION_OBJTYPE,
        BaseEntry: docEntry,
        BaseLine: l.LineNum,
      })),
    };
    if ((quote.NumAtCard ?? "").trim()) orderPayload.NumAtCard = quote.NumAtCard;
    type SapOrder = { DocEntry: number; DocNum: number };
    const order = await sap.post<SapOrder>("/Orders", orderPayload);

    // ── Re-validation STOCK à la conversion (anti « affectation qui date ») ──
    // Un lot pré-affecté sur l'offre il y a plusieurs jours peut être ÉPUISÉ. La
    // commande recopie le U_NoLot tel quel (BaseType 23) et, si elle est
    // entièrement affectée, DISPARAÎT de la file (pendingCount=0) → le lot épuisé
    // partirait sans jamais être revu. On remet donc en EM_PENDING toute ligne
    // dont le lot n'est PLUS EN STOCK (registre à 0) : elle revient dans la file
    // (à ré-affecter un lot présent) ET sera bloquée au départ. La DDM n'entre pas
    // en compte — seule la présence en stock décide.
    try {
      const conv = await sap.get<SapOrderDoc>(`Orders(${order.DocEntry})?$select=DocEntry,DocumentLines`);
      const realKeys = (conv.DocumentLines ?? [])
        .map((l) => ({ itemCode: l.ItemCode, lot: (l.U_NoLot ?? "").trim() }))
        .filter((x) => x.itemCode && isRealLot(x.lot));
      if (realKeys.length > 0) {
        // Registre par (article, lot) : un lot ÉPUISÉ = ligne présente à quantity ≤ 0.
        const rows = await prisma.productBatch.findMany({
          where: {
            warehouseCode: "",
            batchNumber: { in: [...new Set(realKeys.map((k) => k.lot))] },
            product: { itemCode: { in: [...new Set(realKeys.map((k) => k.itemCode as string))] } },
          },
          select: { batchNumber: true, quantity: true, product: { select: { itemCode: true } } },
        });
        const qtyByKey = new Map(rows.map((r) => [`${r.product.itemCode}|${r.batchNumber}`, r.quantity]));
        // Épuisé seulement si le registre CONNAÎT le lot et le donne à 0 (lot hors
        // registre → on ne touche pas, faute de signal fiable).
        const depleted = new Set(
          realKeys.filter((k) => {
            const q = qtyByKey.get(`${k.itemCode}|${k.lot}`);
            return q != null && q <= 0;
          }).map((k) => k.lot),
        );
        if (depleted.size > 0) {
          const patchLines = (conv.DocumentLines ?? [])
            .filter((l) => l.LineNum != null && depleted.has((l.U_NoLot ?? "").trim()))
            .map((l) => ({ LineNum: l.LineNum, U_NoLot: LOT_PENDING }));
          if (patchLines.length > 0) {
            await sap.patch(`Orders(${order.DocEntry})`, { DocumentLines: patchLines });
            console.log(`[BonCommande] Conversion n°${order.DocNum} : ${patchLines.length} ligne(s) à lot ÉPUISÉ remises en attente.`);
          }
        }

        // ── DÉBIT du registre pour les lots CONSERVÉS (fuite corrigée) ──
        // Affecter un lot sur une OFFRE ne débite volontairement pas (l'offre
        // n'engage rien) : le commentaire de l'affectation renvoie le débit « à la
        // COMMANDE ». Mais la commande était créée ICI, par POST direct — sans
        // jamais appeler debitLots. Résultat : un lot affecté puis converti gardait
        // TOUT son solde au registre alors que la marchandise partait. Ces soldes
        // fantômes s'accumulaient sur les vieux lots et, le tri étant FIFO par date
        // d'admission, ressortaient EN PREMIER à l'affectation suivante — d'où des
        // produits mis sur des lots très anciens, déjà écoulés.
        // Les lignes remises en EM_PENDING juste au-dessus sont exclues : elles
        // seront débitées lors de leur ré-affectation (chemin PATCH, wasAllPending).
        const toDebit = (conv.DocumentLines ?? [])
          .map((l) => ({
            itemCode: l.ItemCode,
            lot: (l.U_NoLot ?? "").trim(),
            qty: l.Quantity ?? 0,
          }))
          .filter((x) => x.itemCode && isRealLot(x.lot) && !depleted.has(x.lot) && x.qty > 0);
        if (toDebit.length > 0) {
          try {
            await debitLots(toDebit);
          } catch (e) {
            console.warn("[BonCommande] Débit registre à la conversion échoué (non-bloquant):", (e as Error).message);
          }
        }
      }
    } catch (e) {
      console.warn("[BonCommande] Re-validation stock à la conversion échouée (non-bloquant):", (e as Error).message);
    }

    // La commande issue de l'offre porte des lignes EM_PENDING → à affecter :
    // on la marque « bon de commande » pour qu'elle rejoigne la file des lots.
    const by = session.user?.name?.trim() || session.user?.email || "?";
    await setDeliveryBonCommande(order.DocEntry, true, by).catch((e) =>
      console.warn("[BonCommande] Marquage commande convertie échoué (non-bloquant):", (e as Error).message));

    // ── L'offre est passée en livraison → elle doit DISPARAÎTRE de la liste ──
    // Une fois la commande créée, le bon de commande (l'offre) n'a plus lieu
    // d'être. SAP clôture normalement le devis à la conversion complète, mais pas
    // toujours sur cette base : on force la CLÔTURE (best-effort). « Déjà clôturée »
    // est un succès de fait (le GET ne liste que les devis ouverts). On tente
    // Close puis, à défaut, Cancel — dans les deux cas l'offre quitte l'onglet.
    try {
      await sap.post(`Quotations(${docEntry})/Close`, null);
      console.log(`[BonCommande] Offre n°${quote.DocNum} clôturée après conversion.`);
    } catch (eClose) {
      console.warn(`[BonCommande] Clôture de l'offre ${docEntry} après conversion échouée, repli Cancel:`, (eClose as Error).message);
      try {
        await sap.post(`Quotations(${docEntry})/Cancel`, null);
        console.log(`[BonCommande] Offre n°${quote.DocNum} annulée après conversion.`);
      } catch (eCancel) {
        // Ni Close ni Cancel : l'offre est probablement DÉJÀ clôturée par SAP à la
        // conversion (elle ne remontera plus). On ne bloque pas la réussite.
        console.warn(`[BonCommande] Offre ${docEntry} non clôturée (probablement déjà fermée par SAP):`, (eCancel as Error).message);
      }
    }

    // ── WRITE-THROUGH miroir : la commande créée doit apparaître IMMÉDIATEMENT
    // dans la file (le GET lit SapOrder) et l'offre en disparaître — sans attendre
    // la synchro. On relit la commande finale (états de lot post-revalidation) puis
    // on l'écrit au miroir, et on marque l'offre clôturée. Best-effort.
    try {
      const full = await sap.get<CreatedOrderForMirror>(
        `Orders(${order.DocEntry})?$select=DocEntry,DocNum,DocDate,DocDueDate,CardCode,CardName,DocTotal,VatSum,UpdateDate,DocumentLines`,
      );
      await mirrorCreatedOrder(full);
      await prisma.sapQuotation.updateMany({ where: { docEntry }, data: { documentStatus: "C", syncedAt: new Date() } });
    } catch (e) {
      console.warn("[BonCommande] write-through conversion miroir échoué (rattrapé à la synchro):", (e as Error).message);
    }

    console.log(`[BonCommande] Offre n°${quote.DocNum} → Commande n°${order.DocNum} (passée par ${by})`);
    return NextResponse.json({ ok: true, offreDocNum: quote.DocNum, docNum: order.DocNum, docEntry: order.DocEntry });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error(`[BonCommande] Conversion offre ${docEntry} échouée:`, message);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
