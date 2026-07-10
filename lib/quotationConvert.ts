/**
 * Conversion OFFRE CLIENT (Quotation SAP) → COMMANDE (Order SAP).
 *
 * Un « bon de commande » est une Quotation : il ne réserve pas de stock. Le passer
 * en commande crée un Order qui référence les lignes du devis (BaseType 23 → SAP
 * recopie article/qté/prix/UDF), marque la commande « bon de commande » (lots à
 * affecter) et clôture le devis.
 *
 * Partagé entre l'action manuelle « Passer en commande » (/api/bons-commande) et
 * la VALIDATION AUTOMATIQUE à la réception (/api/sap/goods-receipts) quand le
 * stock couvre enfin toute l'offre.
 */
import { sap } from "@/lib/sapb1";
import { setDeliveryBonCommande } from "@/lib/inventory";

/** Objet SAP oQuotations = 23 (BaseType de la conversion devis → commande). */
export const QUOTATION_OBJTYPE = 23;

interface QuoteLine { LineNum: number; ItemCode?: string; Quantity?: number }
interface QuoteDoc {
  DocEntry: number; DocNum: number; CardCode: string; DocDueDate: string;
  NumAtCard?: string; DocumentStatus?: string; Cancelled?: string;
  DocumentLines?: QuoteLine[];
}

export interface QuotationConvertResult { docNum: number; docEntry: number; offreDocNum: number }

/**
 * Convertit l'offre `docEntry` en commande. Lève si l'offre est annulée, déjà
 * passée, ou sans ligne. `by` = auteur (traçabilité du marquage bon de commande).
 */
export async function convertQuotationToOrder(docEntry: number, by: string): Promise<QuotationConvertResult> {
  const quote = await sap.get<QuoteDoc>(
    `Quotations(${docEntry})?$select=DocEntry,DocNum,CardCode,DocDueDate,NumAtCard,DocumentStatus,Cancelled,DocumentLines`,
  );
  if (quote.Cancelled === "tYES") throw new Error("Offre annulée — conversion impossible.");
  if (quote.DocumentStatus === "bost_Close") throw new Error("Offre déjà passée en commande.");
  const lines = (quote.DocumentLines ?? []).filter((l) => l.LineNum != null);
  if (lines.length === 0) throw new Error("Offre sans ligne.");

  // Chaque ligne de la commande référence la ligne du devis (BaseType 23).
  const orderPayload: Record<string, unknown> = {
    CardCode: quote.CardCode,
    DocDueDate: quote.DocDueDate,
    DocumentLines: lines.map((l) => ({ BaseType: QUOTATION_OBJTYPE, BaseEntry: docEntry, BaseLine: l.LineNum })),
  };
  if ((quote.NumAtCard ?? "").trim()) orderPayload.NumAtCard = quote.NumAtCard;
  const order = await sap.post<{ DocEntry: number; DocNum: number }>("/Orders", orderPayload);

  // La commande issue de l'offre porte des lignes EM_PENDING → file des lots.
  await setDeliveryBonCommande(order.DocEntry, true, by).catch((e) =>
    console.warn("[QuotationConvert] Marquage commande convertie échoué (non-bloquant):", (e as Error).message));

  // L'offre doit quitter la liste : clôture (best-effort) — Close puis repli Cancel.
  // « Déjà fermée » = succès de fait (SAP clôture parfois le devis à la conversion).
  try {
    await sap.post(`Quotations(${docEntry})/Close`, null);
  } catch {
    try { await sap.post(`Quotations(${docEntry})/Cancel`, null); }
    catch { /* probablement déjà fermée par SAP */ }
  }

  return { docNum: order.DocNum, docEntry: order.DocEntry, offreDocNum: quote.DocNum };
}
