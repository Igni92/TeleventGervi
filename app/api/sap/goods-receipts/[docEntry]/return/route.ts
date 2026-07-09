import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { requirePreparateurOrAdmin } from "@/lib/permissions";
import { sap } from "@/lib/sapb1";

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
    return NextResponse.json({ ok: true, docEntry: created.DocEntry, docNum: created.DocNum, fromDocNum: pdn.DocNum, lines: DocumentLines.length });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error(`[Retour] PurchaseReturns depuis EM ${docEntry} échoué:`, message);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
