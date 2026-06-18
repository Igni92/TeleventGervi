/**
 * Récupération du PDF d'une facture — NT-2026-RC-01 (pièces jointes des relances).
 *
 * Le PDF Crystal d'une facture SAP B1 n'est pas exposé par le Service Layer : il
 * faut un service externe qui le REND (cf. docs/crystal-pdf-service). On l'appelle
 * ici en HTTP. Tant que RELANCE_INVOICE_PDF_URL n'est pas défini, la fonction est
 * inerte (aucune pièce jointe) → comportement actuel inchangé.
 *
 *   RELANCE_INVOICE_PDF_URL  ex. https://sap-host:5001/invoice-pdf  (reçoit ?docEntry=)
 *   RELANCE_INVOICE_PDF_KEY  jeton optionnel (envoyé en Authorization: Bearer …)
 */

export interface InvoicePdf {
  name: string;
  /** Contenu du PDF encodé en base64. */
  base64: string;
}

/** True si un service de génération de PDF facture est configuré. */
export function invoicePdfEnabled(): boolean {
  return !!process.env.RELANCE_INVOICE_PDF_URL?.trim();
}

/**
 * Récupère le PDF d'une facture par son DocEntry SAP. Renvoie `null` si le
 * service n'est pas configuré ; lève si le service est configuré mais échoue
 * (pour ne pas envoyer une relance « facture jointe » sans la pièce).
 */
export async function fetchInvoicePdf(docEntry: number, docNum: number | null): Promise<InvoicePdf | null> {
  const base = process.env.RELANCE_INVOICE_PDF_URL?.trim();
  if (!base) return null;

  const url = `${base}${base.includes("?") ? "&" : "?"}docEntry=${encodeURIComponent(String(docEntry))}`;
  const headers: Record<string, string> = {};
  const key = process.env.RELANCE_INVOICE_PDF_KEY?.trim();
  if (key) headers.Authorization = `Bearer ${key}`;

  const res = await fetch(url, { headers });
  if (!res.ok) {
    throw new Error(`PDF de la facture ${docNum ?? docEntry} indisponible (${res.status}).`);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.byteLength === 0) {
    throw new Error(`PDF de la facture ${docNum ?? docEntry} vide.`);
  }
  return { name: `Facture-${docNum ?? docEntry}.pdf`, base64: buf.toString("base64") };
}
