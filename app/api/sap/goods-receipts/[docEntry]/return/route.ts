import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { requirePreparateurOrAdmin } from "@/lib/permissions";
import { sap } from "@/lib/sapb1";
import { debitLots } from "@/lib/lotLedger";
import { applyInventoryDelta } from "@/lib/stockSync";

/**
 * POST /api/sap/goods-receipts/[docEntry]/return
 *
 * RETOUR FOURNISSEUR — crée un document SAP `PurchaseReturns` (sortie de stock,
 * base d'un avoir A/P) à partir d'une ENTRÉE MARCHANDISE (PurchaseDeliveryNote).
 * Total OU partiel : on choisit le nombre de COLIS à retourner par ligne.
 *
 * Body : { lines: [{ lineNum, packageQuantity }] }   // colis à retourner (> 0)
 *
 * Chaque ligne référence la ligne d'origine de l'EM (BaseType=20 / BaseEntry /
 * BaseLine) → SAP reprend article, prix, entrepôt. La quantité est convertie en
 * unité d'inventaire (pie) via le ratio colis→pie de l'EM.
 */

const OBJ_PURCHASE_DELIVERY_NOTE = 20; // ObjectType SAP des entrées marchandise

export async function POST(req: NextRequest, props: { params: Promise<{ docEntry: string }> }) {
  const { docEntry: docEntryStr } = await props.params;
  const docEntry = Number(docEntryStr);
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  // Un retour fournisseur (sortie de stock, base d'avoir A/P) est un geste de
  // gestion : réservé à la préparation / l'administration, pas à l'agréeur.
  if (!(await requirePreparateurOrAdmin(session))) {
    return NextResponse.json({ error: "Réservé à la préparation / l'administration" }, { status: 403 });
  }
  if (!Number.isFinite(docEntry)) return NextResponse.json({ error: "docEntry invalide" }, { status: 400 });

  let body: { lines?: { lineNum: number; packageQuantity: number }[] };
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: "JSON invalide" }, { status: 400 }); }

  const wanted = (body.lines ?? []).filter((l) => Number.isFinite(l.lineNum) && l.packageQuantity > 0);
  if (wanted.length === 0) {
    return NextResponse.json({ error: "Indique au moins une ligne à retourner (colis > 0)." }, { status: 400 });
  }

  // ── Lecture de l'EM source ──
  type PdnLine = { LineNum: number; ItemCode: string; Quantity: number; PackageQuantity?: number; WarehouseCode?: string };
  type Pdn = { DocEntry: number; DocNum: number; CardCode: string; Cancelled?: string; DocumentLines: PdnLine[] };
  let pdn: Pdn;
  try {
    pdn = await sap.get<Pdn>(
      `PurchaseDeliveryNotes(${docEntry})?$select=DocEntry,DocNum,CardCode,Cancelled,DocumentLines`,
    );
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: `Entrée marchandise introuvable : ${e instanceof Error ? e.message : ""}` },
      { status: 404 },
    );
  }
  if (pdn.Cancelled === "tYES") {
    return NextResponse.json({ ok: false, error: "Entrée marchandise annulée — retour impossible." }, { status: 409 });
  }

  const lineByNum = new Map((pdn.DocumentLines || []).map((l) => [l.LineNum, l]));
  const DocumentLines: Record<string, unknown>[] = [];
  // Lot du retour = celui de l'EM source (EM<DocNum>) : un retour est une SORTIE →
  // on débitera le registre par lot (miroir du crédit posé à la réception).
  const returnLot = `EM${pdn.DocNum}`;
  const returnDebits: { itemCode: string; lot: string; qty: number }[] = [];
  // Audit 2026-08-13 (#13) : deltas d'inventaire local à appliquer après le retour.
  // La création d'EM appelle incrementLocalStock (inStock += / available +=) ; le
  // retour (PurchaseReturns) sortait la marchandise dans SAP mais ne touchait QUE
  // le registre par lot, laissant le miroir ProductStock gonflé (~30 min, jusqu'au
  // prochain polling SAP) → sur-stock fantôme. On collecte ici le delta NÉGATIF
  // par article/entrepôt pour le décrémenter symétriquement (cf. plus bas).
  const returnStockDeltas: { itemCode: string; deltaUnits: number; warehouseCode?: string }[] = [];
  for (const w of wanted) {
    const src = lineByNum.get(w.lineNum);
    if (!src) return NextResponse.json({ error: `Ligne ${w.lineNum} introuvable sur l'EM.` }, { status: 400 });
    const pkg = src.PackageQuantity && src.PackageQuantity > 0 ? src.PackageQuantity : null;
    const ratio = pkg ? src.Quantity / pkg : 1;             // pie par colis
    const retPieces = Math.round(w.packageQuantity * ratio * 1000) / 1000;
    if (retPieces <= 0) continue;
    if (retPieces > src.Quantity + 1e-6) {
      return NextResponse.json(
        { error: `Ligne ${w.lineNum} : retour (${w.packageQuantity} colis) supérieur à la quantité reçue.` },
        { status: 400 },
      );
    }
    DocumentLines.push({
      BaseType: OBJ_PURCHASE_DELIVERY_NOTE,
      BaseEntry: docEntry,
      BaseLine: w.lineNum,
      Quantity: retPieces,
      ...(pkg ? { PackageQuantity: w.packageQuantity } : {}),
    });
    if (src.ItemCode) {
      returnDebits.push({ itemCode: src.ItemCode, lot: returnLot, qty: retPieces });
      // Audit 2026-08-13 (#13) : delta local négatif symétrique de l'incrément
      // posé à la création de l'EM (même unité d'inventaire = pie, même entrepôt).
      returnStockDeltas.push({ itemCode: src.ItemCode, deltaUnits: -retPieces, warehouseCode: src.WarehouseCode });
    }
  }
  if (DocumentLines.length === 0) {
    return NextResponse.json({ error: "Aucune ligne valide à retourner." }, { status: 400 });
  }

  try {
    const created = await sap.post<{ DocEntry: number; DocNum: number }>(
      "PurchaseReturns",
      { CardCode: pdn.CardCode, DocumentLines },
    );
    console.log(`[Retour] PurchaseReturns #${created.DocNum} depuis EM #${pdn.DocNum} (${DocumentLines.length} ligne(s))`);
    // Registre : le retour est une sortie du lot d'origine → débit (best-effort).
    if (returnDebits.length > 0) {
      try { await debitLots(returnDebits); }
      catch (e) { console.warn("[Retour] Débit registre lot échoué (non-bloquant):", (e as Error).message); }
    }
    // Audit 2026-08-13 (#13) : décrément local symétrique de l'incrément posé à la
    // création de l'EM. Sans lui, le miroir ProductStock restait sur-évalué jusqu'au
    // prochain polling SAP (sur-stock fantôme ~30 min). applyInventoryDelta touche le
    // stock RÉEL (inStock/available) — bon choix ici car le retour SORT vraiment de la
    // marchandise (≠ decrementLocalStock qui ne modélise qu'une réservation via
    // committed). Clampé ≥ 0 côté helper, best-effort (jamais bloquant).
    if (returnStockDeltas.length > 0) {
      try { await applyInventoryDelta(returnStockDeltas); }
      catch (e) { console.warn("[Retour] Décrément stock local échoué (non-bloquant):", (e as Error).message); }
    }
    return NextResponse.json({ ok: true, docEntry: created.DocEntry, docNum: created.DocNum, fromDocNum: pdn.DocNum, lines: DocumentLines.length });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error(`[Retour] PurchaseReturns depuis EM ${docEntry} échoué:`, message);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
