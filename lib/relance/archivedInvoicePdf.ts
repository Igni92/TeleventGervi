import { prisma } from "@/lib/prisma";
import { readPdf } from "@/lib/archive/storage";
import { fetchInvoicePdf, invoicePdfEnabled, type InvoicePdf } from "@/lib/relance/invoicePdf";

/**
 * PDF d'une facture pour une relance : on prend d'abord le PDF ARCHIVÉ (boîte
 * factures-archive@, stocké localement) ; à défaut on retombe sur le service de
 * rendu Crystal (s'il est configuré). Renvoie null si aucune source.
 *
 * Le repli Crystal peut lever (service HS) — volontaire : l'appelant bloque alors
 * l'envoi (une relance « facture jointe » sans la pièce serait trompeuse).
 */
export async function invoiceAttachment(docEntry: number, docNum: number | null): Promise<InvoicePdf | null> {
  try {
    const doc = await prisma.archivedDocument.findFirst({
      where: {
        docType: "FACTURE",
        OR: [{ docEntry }, ...(docNum != null ? [{ docNum: String(docNum) }] : [])],
      },
      orderBy: { receivedAt: "desc" },
      select: { fileName: true, filePath: true },
    });
    if (doc) {
      const buf = await readPdf(doc.filePath);
      return { name: doc.fileName, base64: buf.toString("base64") };
    }
  } catch {
    // Archive introuvable / fichier manquant → on tente le repli.
  }
  if (invoicePdfEnabled()) return fetchInvoicePdf(docEntry, docNum);
  return null;
}
