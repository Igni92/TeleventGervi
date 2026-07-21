import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getLotMaps, resolveLotForSegment, LOT_PENDING } from "@/lib/lotResolver";
import { getEmAffects } from "@/lib/emAffect";
import { getItemStock, lotInStock, lotStockQty } from "@/lib/lotStock";
import { getLotNotes } from "@/lib/marchandiseNote";
import { colisInfo } from "@/lib/colis";

export const dynamic = "force-dynamic";

/**
 * GET /api/lots/candidates?items=CODE1,CODE2&segment=EXPORT
 *
 * Candidats de LOTS par article pour l'affectation manuelle. Deux origines de lot :
 *   • « EM<DocNum> » — une entrée marchandise (réception fournisseur) ;
 *   • « OP<NNNNN> » — un ordre de PRODUCTION (produit FABRIQUÉ, cf.
 *     /api/sap/assembly). Un article dont le stock vient d'une fabrication n'a
 *     AUCUNE EM : sans ce cas, seul EM_PENDING était proposé. On propose donc
 *     aussi le lot de fabrication (affect « PROD », étiqueté « Fabrication »).
 * On enrichit chaque lot avec le
 * REGISTRE local (lib/lotLedger → ProductBatch) qui tient, PAR EM :
 *   • le COLIS RESTANT (quantité restante, crédité à la réception, débité à la vente),
 *   • le FOURNISSEUR et le PRIX d'achat,
 *   • la note qualité (ÉTOILES, lib/marchandiseNote),
 * et on les trie en FIFO (plus ancienne entrée d'abord).
 *
 * Deux sources fusionnées :
 *   1. REGISTRE : lots avec un reste > 0 → colis-restant PAR-EM fiable (fromLedger) ;
 *   2. RÉSOLVEUR + stock physique (ProductStock) : lots reçus AVANT le registre
 *      (ou hors TeleVent) qui ont du stock article×entrepôt → repli (fromLedger=false),
 *      sans colis-restant par-EM. Évite toute régression si le registre est vide.
 *
 * Réponse : { ok, items: { [itemCode]: {
 *   candidates: [{ lot, docNum, warehouse, affect, qty, colis, fromLedger,
 *                  supplierName, purchasePrice, currency, rating, admissionDate }],  // FIFO
 *   suggested: string | null,
 * } }, pending: "EM_PENDING" }
 */

interface Candidate {
  lot: string;
  docNum: number;
  warehouse: string | null;
  affect: string;                 // segment EM (TOUS/EXPORT/GMS/CHR) ou "PROD" (lot de fabrication)
  qty: number;                    // reste (registre) OU stock article×entrepôt (repli), unité SAP
  colis: number | null;           // reste en COLIS (registre uniquement — sinon null)
  fromLedger: boolean;            // true = colis-restant par-EM fiable (registre)
  supplierName: string | null;
  purchasePrice: number | null;
  currency: string | null;
  rating: number | null;          // note qualité 1..5 (étoiles) du lot
  admissionDate: string | null;   // ISO — clé de tri FIFO
}

function docNumOfLot(lot: string): number {
  const m = /^EM(\d+)$/.exec(lot);
  return m ? Number(m[1]) : 0;
}

/** Lot d'un ordre de PRODUCTION (produit fabriqué, cf. /api/sap/assembly). */
function isOpLot(lot: string): boolean {
  return /^OP\d+$/i.test(lot);
}

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const items = (searchParams.get("items") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 100);
  const segment = (searchParams.get("segment") ?? "").trim().toUpperCase() || null;
  if (items.length === 0) return NextResponse.json({ error: "items requis" }, { status: 400 });

  try {
    const [maps, affects, stock, ledgerRows, prods] = await Promise.all([
      getLotMaps(),
      getEmAffects(),
      getItemStock(items),
      // Registre des lots (par EM réception OU OP fabrication) avec un reste > 0.
      prisma.productBatch.findMany({
        where: {
          product: { itemCode: { in: items } },
          quantity: { gt: 0 },
          OR: [{ batchNumber: { startsWith: "EM" } }, { batchNumber: { startsWith: "OP" } }],
        },
        select: {
          batchNumber: true, quantity: true,
          purchasePrice: true, currency: true, supplierName: true, admissionDate: true,
          product: { select: { itemCode: true } },
        },
      }),
      prisma.product.findMany({
        where: { itemCode: { in: items } },
        select: { itemCode: true, salesUnit: true, salesQtyPerPackUnit: true, salesUnitWeight: true },
      }),
    ]);

    // Diviseur colis par article (quantité SAP → colis).
    const divByItem = new Map<string, number>();
    for (const p of prods) { const d = colisInfo(p).unitsPerColis; divByItem.set(p.itemCode, d > 0 ? d : 1); }
    const toColis = (code: string, qty: number) => Math.round((qty / (divByItem.get(code) ?? 1)) * 10) / 10;

    // Registre indexé par (itemCode, lot) + lots du registre par article.
    const ledgerByKey = new Map<string, (typeof ledgerRows)[number]>();
    const ledgerLotsByItem = new Map<string, Set<string>>();
    for (const r of ledgerRows) {
      const code = r.product.itemCode;
      ledgerByKey.set(`${code}|${r.batchNumber}`, r);
      let set = ledgerLotsByItem.get(code);
      if (!set) { set = new Set(); ledgerLotsByItem.set(code, set); }
      set.add(r.batchNumber);
    }

    // Notes qualité (étoiles) par lot — 1 requête par article (best-effort).
    const notesByItem = new Map<string, Map<string, number>>();
    await Promise.all(items.map(async (code) => {
      const resolverLots = (maps.byItemList.get(code) ?? []).map((d) => `EM${d}`);
      const ledgerLots = [...(ledgerLotsByItem.get(code) ?? [])];
      const lots = [...new Set([...ledgerLots, ...resolverLots])];
      notesByItem.set(code, lots.length ? await getLotNotes(code, lots).catch(() => new Map()) : new Map());
    }));

    // Clé de tri FIFO : date d'entrée (jour), repli n° d'EM croissant.
    const fifoKey = (c: Candidate) => (c.admissionDate ?? "").slice(0, 10);

    const out: Record<string, { candidates: Candidate[]; suggested: string | null }> = {};
    for (const code of items) {
      const notes = notesByItem.get(code) ?? new Map<string, number>();
      const byLot = new Map<string, Candidate>();

      // 1) Lots du REGISTRE (colis-restant par-EM fiable) — MAIS uniquement s'ils
      //    sont RÉELLEMENT EN STOCK. Règle métier : on ne propose que les lots
      //    présents dans le stock. Si l'entrepôt de réception du lot n'a plus de
      //    stock physique (article×entrepôt), le lot est épuisé et n'est PAS
      //    proposé — même si le registre garde un reliquat (dérive possible). La
      //    DLC n'entre pas en compte.
      for (const lot of ledgerLotsByItem.get(code) ?? []) {
        const r = ledgerByKey.get(`${code}|${lot}`);
        if (!r) continue;
        // Lot de FABRICATION (OP<NNNNN>) : produit fabriqué, jamais reçu par un
        // PDN → pas de magasin de réception ni d'affectation segment. On le
        // vérifie sur le stock TOTAL de l'article (warehouse null) et on
        // l'étiquette « PROD » (« Fabrication » côté UI). ⚠️ Ne PAS dériver son
        // docNum via docNumOfLot : la partie numérique d'un OP pourrait entrer en
        // collision avec un vrai DocNum d'EM dans whsOfItemDoc / affects.
        const op = isOpLot(lot);
        const docNum = op ? 0 : docNumOfLot(lot);
        const warehouse = op ? null : (maps.whsOfItemDoc.get(`${code}|${docNum}`) ?? null);
        if (!lotInStock(stock, code, warehouse)) continue;   // épuisé → non proposé
        byLot.set(lot, {
          lot, docNum, warehouse,
          affect: op ? "PROD" : (affects.get(docNum) ?? "TOUS"),
          qty: r.quantity,
          colis: toColis(code, r.quantity),
          fromLedger: true,
          supplierName: op ? (r.supplierName ?? null) : (r.supplierName ?? maps.docMeta.get(docNum)?.supplier ?? null),
          purchasePrice: r.purchasePrice ?? null,
          currency: r.currency ?? null,
          rating: notes.get(lot) ?? null,
          admissionDate: r.admissionDate ? r.admissionDate.toISOString() : (op ? null : (maps.docMeta.get(docNum)?.date ?? null)),
        });
      }

      // Entrepôts déjà couverts par le REGISTRE (per-EM fiable) — on ne leur ajoute
      // pas de lot de repli.
      const ledgerWhs = new Set<string>();
      for (const c of byLot.values()) ledgerWhs.add(c.warehouse ?? "?");

      // 2) Repli (registre absent pour cet entrepôt) : SEULEMENT la PLUS RÉCENTE
      //    EM par entrepôt-avec-stock. Le stock physique vient de la DERNIÈRE
      //    arrivée, pas des vieux lots déjà épuisés — sinon on proposait tout
      //    l'historique des EM tant que l'entrepôt avait du stock (bug signalé).
      //    byItemList est trié DESC par DocNum → la 1re EM vue d'un entrepôt est
      //    la plus récente.
      const fallbackWhsSeen = new Set<string>();
      for (const d of maps.byItemList.get(code) ?? []) {
        const lot = `EM${d}`;
        if (byLot.has(lot)) continue;
        const warehouse = maps.whsOfItemDoc.get(`${code}|${d}`) ?? null;
        const whsKey = warehouse ?? "?";
        if (ledgerWhs.has(whsKey)) continue;          // registre fiable pour cet entrepôt
        if (fallbackWhsSeen.has(whsKey)) continue;    // déjà la plus récente EM de cet entrepôt
        if (!lotInStock(stock, code, warehouse)) continue;
        fallbackWhsSeen.add(whsKey);
        byLot.set(lot, {
          lot, docNum: d, warehouse,
          affect: affects.get(d) ?? "TOUS",
          qty: lotStockQty(stock, code, warehouse),
          colis: null,   // stock article×entrepôt (pas par-EM) → pas de colis-restant fiable
          fromLedger: false,
          supplierName: maps.docMeta.get(d)?.supplier ?? null,
          purchasePrice: null,
          currency: null,
          rating: notes.get(lot) ?? null,
          admissionDate: maps.docMeta.get(d)?.date ?? null,
        });
      }

      // Tri FIFO : plus ancienne EM d'abord (date d'entrée), repli n° d'EM croissant.
      const candidates = [...byLot.values()].sort((a, b) => {
        const ka = fifoKey(a), kb = fifoKey(b);
        if (ka && kb && ka !== kb) return ka < kb ? -1 : 1;
        if (ka && !kb) return -1;
        if (!ka && kb) return 1;
        return a.docNum - b.docNum;
      });

      // Suggestion (segment) : conservée seulement si elle est dans les candidats
      // (donc en stock — la suggestion d'un lot épuisé a déjà été écartée).
      const sug = resolveLotForSegment(maps, affects, code, undefined, segment).lot;
      const suggested = sug && candidates.some((c) => c.lot === sug) ? sug : null;
      out[code] = { candidates, suggested };
    }
    return NextResponse.json({ ok: true, items: out, pending: LOT_PENDING });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
