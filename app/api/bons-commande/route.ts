import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { sap } from "@/lib/sapb1";
import { colisInfo } from "@/lib/colis";
import { getLotMaps, resolveLotForSegment, LOT_PENDING } from "@/lib/lotResolver";
import { getEmAffects } from "@/lib/emAffect";
import { getItemStock } from "@/lib/lotStock";
import { buildLotCandidates, type LotCandidate } from "@/lib/lotCandidates";
import { listBonCommandeDocEntries, setDeliveryBonCommande } from "@/lib/inventory";
import { debitLots, isRealLot } from "@/lib/lotLedger";
import { isLotPending, familyOfLot, LOT_FAMILY_PREFIX } from "@/lib/gervifrais-calc";
import { FRUIT_FAMILIES } from "@/lib/familles";
import { isDepartureReached } from "@/lib/livraison";

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

/**
 * Lecture BRUTE des OFFRES CLIENT (Quotations SAP ouvertes, non annulées) = « bons
 * de commande » TeleVent en attente. Best-effort : échec SAP → [] (l'onglet reste
 * utilisable pour l'affectation des lots des commandes). Les lignes (avec lots +
 * candidats) sont construites dans le GET, en réutilisant le stock/les cartes de
 * lots communs aux offres ET aux commandes.
 */
async function loadOffresRaw(): Promise<SapOrderDoc[]> {
  try {
    const res = await sap.get<{ value: SapOrderDoc[] }>(
      `Quotations?$orderby=DocDueDate asc&$top=100`
      + `&$select=DocEntry,DocNum,DocDate,DocDueDate,CardCode,CardName,NumAtCard,DocumentStatus,Cancelled,DocumentLines`
      + `&$filter=${encodeURIComponent("DocumentStatus eq 'bost_Open' and Cancelled eq 'tNO'")}`,
    );
    return res.value ?? [];
  } catch (e) {
    console.warn("[BonCommande] Lecture des offres (Quotations) échouée:", (e as Error).message);
    return [];
  }
}

type ProductInfo = {
  itemName: string; salesUnit: string | null; salesUnitWeight: number | null;
  salesQtyPerPackUnit: number | null; uMarque: string | null; uCondi: string | null;
  uPays: string | null; uUvc: string | null; frgnName: string | null;
};

export async function GET() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

  const marks = await listBonCommandeDocEntries();
  const markInfo = new Map(marks.map((m) => [m.docEntry, m]));
  const docEntries = marks.map((m) => m.docEntry);

  try {
    // Offres client (Quotations) en attente + commandes marquées « lots à affecter ».
    // On charge les deux jeux BRUTS d'abord, puis on calcule stock/cartes de lots
    // UNE fois pour l'union des articles (offres ⋃ commandes).
    const offresRaw = await loadOffresRaw();

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

    // Union des articles (offres + commandes) → produits, calibre, stock, lots.
    const allDocs = [...offresRaw, ...live];
    const itemCodes = Array.from(new Set(allDocs.flatMap((d) => (d.DocumentLines ?? []).map((l) => l.ItemCode))));
    const pMap = new Map<string, ProductInfo>();
    if (itemCodes.length > 0) {
      const prods = await prisma.product.findMany({
        where: { itemCode: { in: itemCodes } },
        select: { itemCode: true, itemName: true, salesUnit: true, salesUnitWeight: true,
                  salesQtyPerPackUnit: true, uMarque: true, uCondi: true, uPays: true, uUvc: true, frgnName: true },
      });
      for (const p of prods) pMap.set(p.itemCode, p);
    }
    // Calibre (U_GER_CALIBRE) — champ SAP LIVE (hors miroir Product), pour le
    // libellé détaillé au survol. Lots de 20 ; un lot en échec = calibre absent.
    const calibreByItem = new Map<string, string>();
    for (let i = 0; i < itemCodes.length; i += 20) {
      const slice = itemCodes.slice(i, i + 20);
      const filter = "(" + slice.map((c) => `ItemCode eq '${c.replace(/'/g, "''")}'`).join(" or ") + ")";
      try {
        const r = await sap.get<{ value: { ItemCode: string; U_GER_CALIBRE?: string | null }[] }>(
          `Items?$select=ItemCode,U_GER_CALIBRE&$filter=${encodeURIComponent(filter)}&$top=50`,
        );
        for (const it of r.value || []) if (it.U_GER_CALIBRE) calibreByItem.set(it.ItemCode, it.U_GER_CALIBRE);
      } catch { /* lot en échec → pas de calibre pour ces articles */ }
    }
    const unitsPerColis = (code: string) => {
      const p = pMap.get(code);
      return p ? colisInfo(p).unitsPerColis || 1 : 1;
    };

    // Segment client par CardCode (union offres + commandes).
    const cardCodes = Array.from(new Set(allDocs.map((d) => d.CardCode)));
    const typeByCard = new Map<string, string | null>();
    if (cardCodes.length > 0) {
      const clients = await prisma.client.findMany({ where: { code: { in: cardCodes } }, select: { code: true, type: true } });
      for (const c of clients) typeByCard.set(c.code, c.type);
    }
    const segmentOf = (cardCode: string) => (typeByCard.get(cardCode) ?? "").trim().toUpperCase() || null;

    // Cartes de lots + affectations EM + stock physique par article (une fois).
    const [maps, affects, stock] = await Promise.all([getLotMaps(), getEmAffects(), getItemStock(itemCodes)]);
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
        variete: string | null; uvc: string | null; calibre: string | null;
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
            // On PRÉSERVE le sentinel famille tel quel (rappel affiché) ; sinon
            // EM_PENDING générique pour une ligne à découvert, ou le vrai lot.
            lot: linePending ? (famValid ? rawLot : LOT_PENDING) : rawLot,
            pending: linePending,
            familyKey: famValid,
          });
        } else {
          g.quantity += qty;
          g.colisRaw += qty / (unitsPerColis(l.ItemCode) || 1);
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

  // ── Supprimer une offre ──────────────────────────────────────
  // ⚠️ SAP n'autorise pas DELETE sur un devis (« action not supported for this
  // object »). On l'ANNULE via l'action Service Layer `Cancel` ; à défaut on la
  // CLÔTURE (`Close`). Dans les deux cas l'offre quitte l'onglet (le GET ne liste
  // que les devis ouverts ET non annulés).
  if (body.action === "delete") {
    // Les actions SL (Cancel/Close) sont des POST sans corps sur Quotations(id)/Action.
    const runAction = (action: "Cancel" | "Close") => sap.post(`Quotations(${docEntry})/${action}`, null);
    try {
      await runAction("Cancel");
      console.log(`[BonCommande] Offre docEntry ${docEntry} annulée (Cancel).`);
      return NextResponse.json({ ok: true, deleted: true, method: "cancel", docEntry });
    } catch (eCancel) {
      console.warn(`[BonCommande] Cancel offre ${docEntry} échoué, repli Close:`, (eCancel as Error).message);
      try {
        await runAction("Close");
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
      console.log(`[BonCommande] Offre #${quote.DocNum} clôturée après conversion.`);
    } catch (eClose) {
      console.warn(`[BonCommande] Clôture de l'offre ${docEntry} après conversion échouée, repli Cancel:`, (eClose as Error).message);
      try {
        await sap.post(`Quotations(${docEntry})/Cancel`, null);
        console.log(`[BonCommande] Offre #${quote.DocNum} annulée après conversion.`);
      } catch (eCancel) {
        // Ni Close ni Cancel : l'offre est probablement DÉJÀ clôturée par SAP à la
        // conversion (elle ne remontera plus). On ne bloque pas la réussite.
        console.warn(`[BonCommande] Offre ${docEntry} non clôturée (probablement déjà fermée par SAP):`, (eCancel as Error).message);
      }
    }

    console.log(`[BonCommande] Offre #${quote.DocNum} → Commande #${order.DocNum} (passée par ${by})`);
    return NextResponse.json({ ok: true, offreDocNum: quote.DocNum, docNum: order.DocNum, docEntry: order.DocEntry });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error(`[BonCommande] Conversion offre ${docEntry} échouée:`, message);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
