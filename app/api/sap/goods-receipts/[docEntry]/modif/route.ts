import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { requirePreparateurOrAdmin } from "@/lib/permissions";
import { sap } from "@/lib/sapb1";

/**
 * POST /api/sap/goods-receipts/[docEntry]/modif
 *
 * Modifie le PRIX des lignes d'une ENTRÉE MARCHANDISE (PurchaseDeliveryNote).
 * Sur une EM, la marchandise est déjà entrée : on ne touche NI à la quantité NI
 * à l'article — seulement le prix unitaire OU le total HT de ligne (forcé).
 *
 * Body : { lines: [{ lineNum, price?, lineTotal? }] }
 *   - lineTotal fourni → total HT forcé (SAP recalcule le PU) ;
 *   - sinon price → prix unitaire (le total se déduit).
 *
 * PATCH par LineNum (fusion normale du Service Layer : les lignes non listées et
 * leurs quantités sont conservées). Refus si l'EM est clôturée (facture A/P créée).
 */
export async function POST(req: NextRequest, props: { params: Promise<{ docEntry: string }> }) {
  const { docEntry: docEntryStr } = await props.params;
  const docEntry = Number(docEntryStr);
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  // Modifier le PRIX d'une entrée marchandise est réservé à la préparation /
  // l'administration : l'agréeur ne voit ni ne touche aux prix.
  if (!(await requirePreparateurOrAdmin(session))) {
    return NextResponse.json({ error: "Réservé à la préparation / l'administration" }, { status: 403 });
  }
  if (!Number.isFinite(docEntry)) return NextResponse.json({ error: "docEntry invalide" }, { status: 400 });

  let body: { lines?: { lineNum: number; price?: number; lineTotal?: number }[] };
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: "JSON invalide" }, { status: 400 }); }

  const lines = (body.lines ?? []).filter((l) => Number.isFinite(l.lineNum));
  if (lines.length === 0) {
    return NextResponse.json({ error: "Aucune ligne à mettre à jour." }, { status: 400 });
  }

  // ── Garde-fou : EM existante et non clôturée ──
  type Pdn = { DocEntry: number; DocNum: number; DocumentStatus?: string };
  let pdn: Pdn;
  try {
    pdn = await sap.get<Pdn>(`PurchaseDeliveryNotes(${docEntry})?$select=DocEntry,DocNum,DocumentStatus`);
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: `Entrée marchandise introuvable : ${e instanceof Error ? e.message : ""}` },
      { status: 404 },
    );
  }
  if (pdn.DocumentStatus === "bost_Close") {
    return NextResponse.json(
      { ok: false, error: "Entrée marchandise clôturée (facture créée) — prix non modifiable." },
      { status: 409 },
    );
  }

  // ── PATCH par LineNum : prix unitaire OU total HT forcé ──
  const DocumentLines = lines.map((l) => {
    const line: Record<string, unknown> = { LineNum: l.lineNum };
    if (l.lineTotal != null && l.lineTotal >= 0) {
      line.LineTotal = l.lineTotal;             // total forcé → SAP recalcule le PU
    } else if (l.price != null && l.price >= 0) {
      line.UnitPrice = l.price;
      line.Price = l.price;
    }
    return line;
  });

  try {
    await sap.patch(`PurchaseDeliveryNotes(${docEntry})`, { DocumentLines });
    let totals: { totalTTC: number | null; totalHT: number | null } = { totalTTC: null, totalHT: null };
    try {
      const r = await sap.get<{ DocTotal?: number; VatSum?: number }>(
        `PurchaseDeliveryNotes(${docEntry})?$select=DocTotal,VatSum`,
      );
      totals = { totalTTC: r.DocTotal ?? null, totalHT: (r.DocTotal ?? 0) - (r.VatSum ?? 0) };
    } catch { /* non bloquant */ }
    return NextResponse.json({ ok: true, docEntry, docNum: pdn.DocNum, updatedLines: DocumentLines.length, ...totals });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error(`[EMModif] PATCH PurchaseDeliveryNotes(${docEntry}) échoué:`, message);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
