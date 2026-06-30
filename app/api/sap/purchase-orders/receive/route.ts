import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { requireAdmin } from "@/lib/permissions";
import { sap } from "@/lib/sapb1";
import { incrementLocalStock } from "@/lib/stockSync";
import { bumpLot } from "@/lib/lotResolver";

/**
 * POST /api/sap/purchase-orders/receive  { docEntry }
 *
 * « Valider la réception » d'une COMMANDE FOURNISSEUR (PurchaseOrder) : crée le
 * bon de réception (PurchaseDeliveryNote) à partir de la commande — chaque ligne
 * référence la ligne de la commande (BaseType=22) → SAP copie quantités/prix et
 * CLÔTURE la commande. La commande « passe » alors en entrée marchandise.
 *
 * Effets de bord (cohérents avec /api/sap/goods-receipts) :
 *   - lot « EM<DocNum> » posé sur chaque ligne du BR ;
 *   - cache des lots (bumpLot) + incrément optimiste du stock local (latence 0).
 */
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  // #7 — Valider la réception crée une entrée marchandise et incrémente le stock :
  // écriture de la chaîne fournisseur réservée aux admins / direction (pas un commercial).
  if (!(await requireAdmin(session))) return NextResponse.json({ error: "Réservé à l'administration / direction" }, { status: 403 });

  let body: { docEntry?: number };
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: "JSON invalide" }, { status: 400 }); }

  const poEntry = Number(body.docEntry);
  if (!poEntry || Number.isNaN(poEntry)) {
    return NextResponse.json({ error: "docEntry (commande) requis" }, { status: 400 });
  }

  // ── 1. Lecture de la commande fournisseur (lignes encore ouvertes) ──
  type PoLine = {
    LineNum: number; ItemCode: string; WarehouseCode?: string;
    RemainingOpenQuantity?: number; Quantity?: number; LineStatus?: string;
  };
  type Po = {
    DocEntry: number; DocNum: number; CardCode: string;
    DocumentStatus?: string; DocumentLines: PoLine[];
  };
  let po: Po;
  try {
    po = await sap.get<Po>(
      `PurchaseOrders(${poEntry})?$select=DocEntry,DocNum,CardCode,DocumentStatus,DocumentLines`,
    );
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: `Commande fournisseur introuvable : ${e instanceof Error ? e.message : ""}` },
      { status: 404 },
    );
  }
  if (po.DocumentStatus === "bost_Close") {
    return NextResponse.json({ ok: false, error: "Commande déjà clôturée." }, { status: 409 });
  }

  // Lignes encore ouvertes uniquement (on ne re-réceptionne pas une ligne close).
  const openLines = (po.DocumentLines || []).filter((l) => l.LineStatus !== "bost_Close");
  if (openLines.length === 0) {
    return NextResponse.json({ ok: false, error: "Aucune ligne ouverte à réceptionner." }, { status: 409 });
  }

  // ── 2. PDN basé sur la commande (BaseType=22 → SAP copie qté/prix, clôture la commande) ──
  const today = new Date().toISOString().slice(0, 10);
  const payload: Record<string, unknown> = {
    CardCode: po.CardCode,
    DocDate: today,
    DocDueDate: today,
    TaxDate: today,
    Comments: `Réception de la commande fournisseur #${po.DocNum} via TeleVent — ${session.user?.name ?? session.user?.email ?? "?"}`,
    DocumentLines: openLines.map((l) => ({
      BaseType: 22,            // 22 = PurchaseOrder
      BaseEntry: po.DocEntry,
      BaseLine: l.LineNum,
    })),
  };

  type SapPdn = { DocEntry: number; DocNum: number };
  let created: SapPdn;
  try {
    created = await sap.post<SapPdn>("/PurchaseDeliveryNotes", payload);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error("[POReceive] ❌ SAP CREATE FAILED:", message);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }

  const lotCode = `EM${created.DocNum}`;

  // ── 3. Lot EM<DocNum> + refetch des lignes créées (qté/entrepôt pour le stock) ──
  type CreatedLine = { LineNum: number; ItemCode: string; Quantity: number; WarehouseCode?: string };
  let createdLines: CreatedLine[] = [];
  try {
    const refetch = await sap.get<{ DocumentLines: CreatedLine[] }>(
      `/PurchaseDeliveryNotes(${created.DocEntry})?$select=DocumentLines`,
    );
    createdLines = refetch.DocumentLines || [];
    const patchLines = createdLines.map((l) => ({ LineNum: l.LineNum, U_NoLot: lotCode }));
    if (patchLines.length > 0) {
      await sap.patch(`PurchaseDeliveryNotes(${created.DocEntry})`, { DocumentLines: patchLines });
    }
  } catch (e) {
    console.warn("[POReceive] PATCH U_NoLot échoué (non-bloquant):", (e as Error).message);
  }

  // ── 4. Cache lots + incrément stock local (latence 0) ──
  for (const l of createdLines) {
    if (l.WarehouseCode) bumpLot(l.ItemCode, l.WarehouseCode, created.DocNum);
  }
  try {
    await incrementLocalStock(
      createdLines
        .filter((l) => l.WarehouseCode)
        .map((l) => ({ itemCode: l.ItemCode, quantity: l.Quantity, warehouseCode: l.WarehouseCode as string })),
    );
  } catch (e) {
    console.warn("[POReceive] incrementLocalStock échoué (non-bloquant):", (e as Error).message);
  }

  return NextResponse.json({
    ok: true,
    docNum: created.DocNum,
    docEntry: created.DocEntry,
    lot: lotCode,
    fromPoNum: po.DocNum,
  });
}
