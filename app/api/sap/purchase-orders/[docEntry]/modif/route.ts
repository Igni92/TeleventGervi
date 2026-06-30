import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { requirePreparateurOrAdmin } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { sap } from "@/lib/sapb1";
import { writeAudit } from "@/lib/audit";

const WHITELIST_WHS = new Set(["000", "01", "R1"]);

/**
 * POST /api/sap/purchase-orders/[docEntry]/modif
 *
 * Modifie une COMMANDE FOURNISSEUR (PurchaseOrder) tant qu'elle n'est PAS encore
 * réceptionnée (aucune EM / entrée marchandise créée dessus). Saisie en COLIS
 * (comme la création) : on renvoie Quantity (pie) ET PackageQuantity (colis).
 *
 * Body : { lines: [{ itemCode, packageQuantity, warehouseCode, price? }] }
 *
 * Remplacement COMPLET de la collection de lignes (B1S-ReplaceCollectionsOnPatch)
 * → permet d'ajouter / supprimer / réordonner des lignes, comme la modif de
 * commande de vente. Le n° de commande (DocNum) est préservé (jamais de 2ᵉ doc).
 *
 * Garde-fous : refus si la commande est clôturée (déjà réceptionnée) ou si une
 * ligne a déjà été reçue (LineStatus close) — dans ce cas c'est une EM, pas une
 * simple commande, et seul le prix est modifiable (cf. édition d'EM).
 */
export async function POST(req: NextRequest, props: { params: Promise<{ docEntry: string }> }) {
  const { docEntry: docEntryStr } = await props.params;
  const docEntry = Number(docEntryStr);
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  // #7 — Modifier une commande fournisseur est une écriture de la chaîne d'achat :
  // réservée à la préparation / l'administration (pas accessible à un simple commercial).
  if (!(await requirePreparateurOrAdmin(session))) return NextResponse.json({ error: "Réservé à la préparation / l'administration" }, { status: 403 });
  if (!Number.isFinite(docEntry)) return NextResponse.json({ error: "docEntry invalide" }, { status: 400 });

  let body: { lines?: { itemCode: string; packageQuantity: number; warehouseCode: string; price?: number; lineTotal?: number }[] };
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: "JSON invalide" }, { status: 400 }); }

  const lines = (body.lines ?? []).filter((l) => l.itemCode && l.packageQuantity > 0);
  if (lines.length === 0) {
    return NextResponse.json({ error: "La commande doit garder au moins une ligne." }, { status: 400 });
  }
  for (const l of lines) {
    if (!l.warehouseCode || !WHITELIST_WHS.has(l.warehouseCode)) {
      return NextResponse.json({ error: `Entrepôt invalide : ${l.warehouseCode}` }, { status: 400 });
    }
  }

  // ── Lecture de la commande + garde-fous (pas encore réceptionnée) ──
  type PoLine = { LineNum: number; LineStatus?: string };
  type Po = { DocEntry: number; DocNum: number; DocumentStatus?: string; DocumentLines: PoLine[] };
  let po: Po;
  try {
    po = await sap.get<Po>(`PurchaseOrders(${docEntry})?$select=DocEntry,DocNum,DocumentStatus,DocumentLines`);
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: `Commande fournisseur introuvable : ${e instanceof Error ? e.message : ""}` },
      { status: 404 },
    );
  }
  if (po.DocumentStatus === "bost_Close") {
    return NextResponse.json(
      { ok: false, error: "Commande déjà réceptionnée (entrée marchandise créée) — modification impossible." },
      { status: 409 },
    );
  }
  if ((po.DocumentLines || []).some((l) => l.LineStatus === "bost_Close")) {
    return NextResponse.json(
      { ok: false, error: "Commande déjà partiellement réceptionnée — modification impossible." },
      { status: 409 },
    );
  }

  // Ratio colis → pie depuis le catalogue local (même règle que la création).
  const codes = Array.from(new Set(lines.map((l) => l.itemCode)));
  const products = await prisma.product.findMany({
    where: { itemCode: { in: codes } },
    select: { itemCode: true, salesQtyPerPackUnit: true },
  });
  const ratioOf = new Map(
    products.map((p) => [p.itemCode, p.salesQtyPerPackUnit && p.salesQtyPerPackUnit > 1 ? p.salesQtyPerPackUnit : 1]),
  );

  const DocumentLines = lines.map((l, idx) => {
    const ratio = Number(ratioOf.get(l.itemCode)) || 1;
    const line: Record<string, unknown> = {
      LineNum: idx,
      ItemCode: l.itemCode,
      Quantity: l.packageQuantity * ratio,
      PackageQuantity: l.packageQuantity,
      WarehouseCode: l.warehouseCode,
    };
    // Total HT FORCÉ (l.lineTotal) → SAP recalcule le prix unitaire depuis le
    // total. Sinon, prix unitaire saisi (le total se déduit de qté × PU).
    if (l.lineTotal != null && l.lineTotal >= 0) {
      line.LineTotal = l.lineTotal;
    } else if (l.price != null && l.price > 0) {
      line.UnitPrice = l.price;
      line.Price = l.price;
    }
    return line;
  });

  try {
    await sap.patch(
      `PurchaseOrders(${docEntry})`,
      { DocumentLines },
      { headers: { "B1S-ReplaceCollectionsOnPatch": "true" } },
    );
    let totals: { totalTTC: number | null; totalHT: number | null } = { totalTTC: null, totalHT: null };
    try {
      const r = await sap.get<{ DocTotal?: number; VatSum?: number }>(
        `PurchaseOrders(${docEntry})?$select=DocTotal,VatSum`,
      );
      totals = { totalTTC: r.DocTotal ?? null, totalHT: (r.DocTotal ?? 0) - (r.VatSum ?? 0) };
    } catch { /* non bloquant */ }
    await writeAudit({ session, action: "PO_MODIF", entity: "PurchaseOrder", entityId: String(docEntry), summary: `Modification commande fournisseur #${po.DocNum}`, details: { docNum: po.DocNum, totalLines: DocumentLines.length, ...totals } });
    return NextResponse.json({ ok: true, docEntry, docNum: po.DocNum, totalLines: DocumentLines.length, ...totals });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error(`[POModif] PATCH PurchaseOrders(${docEntry}) échoué:`, message);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
