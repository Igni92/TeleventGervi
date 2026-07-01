import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getAccessScope, cardCodeInScope } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { sap } from "@/lib/sapb1";
import { mirrorCreatedOrder, mirrorCancelOrder, type CreatedOrderForMirror } from "@/lib/sapMirror";
import { LOT_PENDING } from "@/lib/lotResolver";
import { writeAudit } from "@/lib/audit";

/**
 * Changer le CLIENT d'une commande (« re-coder » un BL).
 *
 * SAP B1 n'autorise pas à modifier le CardCode d'une commande existante. Quand
 * une commande a été saisie sur le MAUVAIS client, on la corrige donc en deux
 * temps : on **recrée** la commande à l'identique sous le bon CardCode, puis on
 * **annule** l'ancienne. On crée AVANT d'annuler : si la création échoue,
 * l'ancienne commande reste intacte (aucune perte). Si l'annulation échoue après
 * une création réussie, on le signale clairement (doublon à annuler à la main).
 *
 * GET  /api/sap/orders/rebind?cardCode=XXXX
 *   → valide un CardCode (aperçu pour le garde-fou) : { ok, cardCode, cardName, frozen, valid }
 *
 * POST /api/sap/orders/rebind
 *   Body : { docEntry: number, newCardCode: string }
 *   → { ok, oldDocEntry, oldDocNum, newDocEntry, newDocNum, newCardCode, newCardName, cancelledOld }
 */

type SapBp = { CardCode: string; CardName?: string; Frozen?: string; Valid?: string };

type SapLine = {
  ItemCode?: string; Quantity?: number; WarehouseCode?: string;
  UnitPrice?: number; Price?: number; DiscountPercent?: number;
  U_NoLot?: string; U_GER_Pays?: string; U_GER_Marque?: string; U_GER_Condi?: string; U_NomMag?: string;
  LineType?: string; FreeText?: string;
  DocumentLineAdditionalExpenses?: { GroupCode?: number; ExpenseCode?: number; LineTotal?: number }[];
};
type SapOrder = {
  DocEntry: number; DocNum: number; CardCode: string;
  DocDate: string; DocDueDate: string; TaxDate?: string;
  DocumentStatus?: string; Cancelled?: string; Comments?: string; NumAtCard?: string;
  U_TrspCode?: string; U_Timbre?: string | number; U_TrspHeur?: string;
  DocumentLines: SapLine[];
};

/** Valide un CardCode dans SAP (existence + statut). Renvoie le BP ou une erreur. */
async function fetchBusinessPartner(cardCode: string): Promise<SapBp | null> {
  try {
    return await sap.get<SapBp>(
      `BusinessPartners('${encodeURIComponent(cardCode)}')?$select=CardCode,CardName,Frozen,Valid`,
    );
  } catch {
    return null;
  }
}

/** Reconstruit une ligne de commande clonée (whitelist des champs re-postables). */
function cloneLine(l: SapLine, lineNum: number): Record<string, unknown> {
  // Ligne TEXTE (note / promo) : pas d'ItemCode → on préserve le libellé.
  if (!l.ItemCode && (l.FreeText ?? "").trim()) {
    return { LineNum: lineNum, LineType: "dlt_Text", FreeText: (l.FreeText ?? "").slice(0, 254) };
  }
  const nl: Record<string, unknown> = { LineNum: lineNum, ItemCode: l.ItemCode, Quantity: l.Quantity };
  if (l.WarehouseCode) nl.WarehouseCode = l.WarehouseCode;

  // Prix : on FIGE le prix d'origine (le client change, le montant reste). On
  // pose le prix brut + la remise (SAP recalcule le net) ; sans remise, on pose
  // aussi Price. On ne copie PAS le code de taxe : SAP le dérive du nouveau BP.
  const gross = typeof l.UnitPrice === "number" && l.UnitPrice > 0 ? l.UnitPrice : (l.Price ?? 0);
  if (gross > 0) {
    nl.UnitPrice = gross;
    const disc = Number(l.DiscountPercent) || 0;
    if (disc > 0) nl.DiscountPercent = Math.min(100, Math.max(0, disc));
    else nl.Price = gross;
  }

  // Champs Gervifrais + lot (garde-fou : jamais de ligne sans lot).
  if (l.U_GER_Pays) nl.U_GER_Pays = l.U_GER_Pays;
  if (l.U_GER_Marque) nl.U_GER_Marque = l.U_GER_Marque;
  if (l.U_GER_Condi) nl.U_GER_Condi = l.U_GER_Condi;
  if (l.U_NomMag) nl.U_NomMag = l.U_NomMag;
  nl.U_NoLot = (l.U_NoLot ?? "").trim() || LOT_PENDING;

  // TPF (INTERFEL / DDG) — montants fixes, indépendants du client : copiés tels quels.
  const exps = (l.DocumentLineAdditionalExpenses ?? [])
    .filter((e) => e.ExpenseCode != null && (e.LineTotal ?? 0) > 0)
    .map((e) => ({ GroupCode: e.GroupCode, ExpenseCode: e.ExpenseCode, LineTotal: e.LineTotal }));
  if (exps.length > 0) nl.DocumentLineAdditionalExpenses = exps;

  return nl;
}

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

  const cardCode = req.nextUrl.searchParams.get("cardCode")?.trim();
  if (!cardCode) return NextResponse.json({ ok: false, error: "cardCode requis" }, { status: 400 });

  const bp = await fetchBusinessPartner(cardCode);
  if (!bp) {
    return NextResponse.json(
      { ok: false, error: `Client « ${cardCode} » introuvable dans SAP « ${process.env.SAP_B1_COMPANY_DB} ».` },
      { status: 404 },
    );
  }
  return NextResponse.json({
    ok: true,
    cardCode: bp.CardCode,
    cardName: bp.CardName ?? bp.CardCode,
    frozen: bp.Frozen === "tYES",
    valid: bp.Valid !== "tNO",
  });
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

  let body: { docEntry?: number; newCardCode?: string };
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: "JSON invalide" }, { status: 400 }); }

  const docEntry = Number(body.docEntry);
  const newCardCode = (body.newCardCode ?? "").trim();
  if (!Number.isFinite(docEntry)) return NextResponse.json({ error: "docEntry requis" }, { status: 400 });
  if (!newCardCode) return NextResponse.json({ error: "newCardCode requis" }, { status: 400 });

  // ── 1. Charge la commande d'origine (toutes les lignes + en-tête) ──
  let order: SapOrder;
  try {
    order = await sap.get<SapOrder>(`Orders(${docEntry})`);
  } catch {
    return NextResponse.json({ ok: false, error: `Commande ${docEntry} introuvable dans SAP.` }, { status: 404 });
  }

  // ── 2. Périmètre : ancien ET nouveau client (admin passe partout) ──
  const scope = await getAccessScope(session);
  if (!(await cardCodeInScope(scope, order.CardCode))) {
    return NextResponse.json({ error: "Commande hors de votre périmètre" }, { status: 403 });
  }
  if (!(await cardCodeInScope(scope, newCardCode))) {
    return NextResponse.json({ error: "Client cible hors de votre périmètre" }, { status: 403 });
  }

  // ── 3. Garde-fous d'état ──
  if (order.Cancelled === "tYES") {
    return NextResponse.json({ ok: false, error: "Commande déjà annulée." }, { status: 409 });
  }
  if (order.DocumentStatus === "bost_Close") {
    return NextResponse.json(
      { ok: false, error: "Commande clôturée (livrée / facturée) — re-codage impossible." },
      { status: 409 },
    );
  }
  if (newCardCode.toUpperCase() === order.CardCode.toUpperCase()) {
    return NextResponse.json({ ok: false, error: "Le client cible est déjà celui de la commande." }, { status: 400 });
  }

  // ── 4. Valide le nouveau client (existence + non gelé / valide) ──
  const bp = await fetchBusinessPartner(newCardCode);
  if (!bp) {
    return NextResponse.json(
      { ok: false, error: `Client « ${newCardCode} » introuvable dans SAP « ${process.env.SAP_B1_COMPANY_DB} ».` },
      { status: 400 },
    );
  }
  if (bp.Frozen === "tYES" || bp.Valid === "tNO") {
    return NextResponse.json(
      { ok: false, error: `Client « ${newCardCode} » ${bp.Frozen === "tYES" ? "GELÉ" : "invalide"} dans SAP — re-codage impossible.` },
      { status: 409 },
    );
  }

  // ── 5. Construit la commande clonée sous le nouveau CardCode ──
  const today = new Date().toISOString().slice(0, 10);
  const dueDate = (order.DocDueDate ?? today).slice(0, 10);
  const documentLines = (order.DocumentLines ?? []).map((l, i) => cloneLine(l, i));
  if (documentLines.length === 0) {
    return NextResponse.json({ ok: false, error: "Commande sans ligne — rien à recréer." }, { status: 400 });
  }

  const payload: Record<string, unknown> = {
    CardCode: bp.CardCode,
    DocDate: today,
    DocDueDate: dueDate,
    TaxDate: today,
    DocumentLines: documentLines,
  };
  if (order.Comments?.trim()) payload.Comments = order.Comments.trim();
  if (order.NumAtCard?.trim()) payload.NumAtCard = order.NumAtCard.trim();
  // Transporteur / tournée conservés (le re-codage ne change que le client).
  if (order.U_TrspCode?.trim()) payload.U_TrspCode = order.U_TrspCode.trim();
  if (order.U_Timbre != null && order.U_Timbre !== "") payload.U_Timbre = order.U_Timbre;
  if (order.U_TrspHeur?.trim()) payload.U_TrspHeur = order.U_TrspHeur.trim();

  // ── 6. Crée la nouvelle commande (AVANT d'annuler l'ancienne) ──
  type Created = { DocEntry: number; DocNum: number; DocTotal?: number };
  let created: Created;
  try {
    created = await sap.post<Created>("/Orders", payload);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error("[Rebind] Création de la commande recodée échouée:", message);
    return NextResponse.json(
      { ok: false, error: `Recréation impossible — ancienne commande conservée. Détail SAP : ${message}` },
      { status: 500 },
    );
  }

  // Miroir optimiste de la nouvelle commande (non bloquant).
  let enriched: CreatedOrderForMirror | null = null;
  try {
    enriched = await sap.get<CreatedOrderForMirror>(
      `Orders(${created.DocEntry})?$select=DocEntry,DocNum,DocDate,CardCode,CardName,DocTotal,VatSum,DocumentLines`,
    );
    if (enriched?.DocEntry != null && enriched.DocDate && enriched.CardCode) await mirrorCreatedOrder(enriched);
  } catch (e) {
    console.warn("[Rebind] Miroir création (non-bloquant):", (e as Error).message);
  }

  // ── 7. Annule l'ancienne commande ──
  let cancelledOld = false;
  try {
    await sap.post(`Orders(${docEntry})/Cancel`, undefined);
    cancelledOld = true;
    try { await mirrorCancelOrder(docEntry); } catch (e) { console.warn("[Rebind] Miroir annulation (non-bloquant):", (e as Error).message); }
  } catch (e) {
    console.error("[Rebind] Annulation de l'ancienne commande échouée:", (e as Error).message);
  }

  await writeAudit({
    session,
    action: "ORDER_REBIND",
    entity: "SapOrder",
    entityId: String(docEntry),
    summary: `Re-codage BL #${order.DocNum} : ${order.CardCode} → ${bp.CardCode} (nouveau BL #${created.DocNum})`,
    details: {
      oldDocEntry: docEntry, oldDocNum: order.DocNum, oldCardCode: order.CardCode,
      newDocEntry: created.DocEntry, newDocNum: created.DocNum, newCardCode: bp.CardCode,
      cancelledOld,
    },
  });

  return NextResponse.json({
    ok: true,
    oldDocEntry: docEntry,
    oldDocNum: order.DocNum,
    newDocEntry: created.DocEntry,
    newDocNum: created.DocNum,
    newCardCode: bp.CardCode,
    newCardName: bp.CardName ?? bp.CardCode,
    cancelledOld,
    // Avertissement explicite si l'ancienne n'a pas pu être annulée (doublon à traiter).
    warning: cancelledOld ? null : `Nouvelle commande #${created.DocNum} créée, mais l'ancienne #${order.DocNum} n'a pas pu être annulée automatiquement — annule-la manuellement dans SAP.`,
    db: process.env.SAP_B1_COMPANY_DB,
  });
}
