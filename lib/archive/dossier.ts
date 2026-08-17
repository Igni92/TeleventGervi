import { prisma } from "@/lib/prisma";
import { sap } from "@/lib/sapb1";

/**
 * Précalcule le pivot de DOSSIER (invoiceEntry = DocEntry de la facture centrale)
 * sur les documents archivés qui ne l'ont pas encore, pour que « dossier lié »
 * (BL → Facture → Avoir) soit un simple lookup LOCAL instantané.
 *
 * Liens SAP : ligne de facture BaseType=17 → BaseEntry = commande (BL) ;
 *             ligne d'avoir   BaseType=13 → BaseEntry = facture.
 * Résolution par CardCode (une paire de requêtes SAP par client), plafonnée pour
 * rester légère : le reste est traité aux passages suivants. Best-effort.
 */
type Line = { BaseType?: number; BaseEntry?: number };
type Doc = { DocEntry: number; DocumentLines?: Line[] };

export async function resolveInvoiceEntries(maxCardCodes = 30): Promise<{ resolved: number; remaining: number }> {
  const pending = await prisma.archivedDocument.findMany({
    where: { invoiceEntry: null, docEntry: { not: null }, cardCode: { not: null } },
    select: { id: true, docType: true, docEntry: true, cardCode: true },
  });
  if (pending.length === 0) return { resolved: 0, remaining: 0 };

  // Groupe par CardCode.
  const byCard = new Map<string, typeof pending>();
  for (const d of pending) {
    const cc = d.cardCode as string;
    const arr = byCard.get(cc) ?? [];
    arr.push(d);
    byCard.set(cc, arr);
  }
  const cards = [...byCard.keys()].slice(0, maxCardCodes);

  let resolved = 0;
  for (const cc of cards) {
    try {
      const esc = cc.replace(/'/g, "''");
      const [invoices, creditNotes] = await Promise.all([
        sap.getAll<Doc>(`Invoices?$select=DocEntry,DocumentLines&$filter=${encodeURIComponent(`CardCode eq '${esc}'`)}`, { maxPages: 8 }),
        sap.getAll<Doc>(`CreditNotes?$select=DocEntry,DocumentLines&$filter=${encodeURIComponent(`CardCode eq '${esc}'`)}`, { maxPages: 8 }),
      ]);
      // Commande (BL) → facture.
      const invByOrder = new Map<number, number>();
      const invoiceEntries = new Set<number>();
      for (const f of invoices) {
        invoiceEntries.add(f.DocEntry);
        for (const l of f.DocumentLines ?? []) if (l.BaseType === 17 && l.BaseEntry != null && !invByOrder.has(l.BaseEntry)) invByOrder.set(l.BaseEntry, f.DocEntry);
      }
      // Avoir → facture d'origine.
      const invByCredit = new Map<number, number>();
      for (const c of creditNotes) {
        for (const l of c.DocumentLines ?? []) if (l.BaseType === 13 && l.BaseEntry != null) { invByCredit.set(c.DocEntry, l.BaseEntry); break; }
      }

      for (const d of byCard.get(cc) ?? []) {
        let hub: number | null = null;
        if (d.docType === "FACTURE") hub = d.docEntry;
        else if (d.docType === "BL") hub = invByOrder.get(d.docEntry as number) ?? null;
        else if (d.docType === "AVOIR") hub = invByCredit.get(d.docEntry as number) ?? null;
        if (hub != null) {
          await prisma.archivedDocument.update({ where: { id: d.id }, data: { invoiceEntry: hub } }).catch(() => {});
          resolved++;
        }
      }
    } catch {
      // Client en échec (SAP indispo, session…) → retenté au prochain passage.
    }
  }

  const remaining = pending.length - resolved;
  return { resolved, remaining };
}
