"use client";

import { FileText, Download, Send } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";

/**
 * Aperçu d'un PDF archivé DANS une fenêtre (iframe) — pas un nouvel onglet.
 * Réutilisé par l'état documentaire (clic sur une ligne) et par DocumentActions.
 */
export function PdfPreviewDialog({
  docId, fileName, open, onOpenChange, onSend,
}: {
  docId: string | null;
  fileName?: string | null;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  /** Optionnel : bouton « Envoyer au client » dans l'en-tête de l'aperçu. */
  onSend?: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl w-[92vw] h-[88vh] p-0 gap-0 overflow-hidden flex flex-col">
        <DialogHeader className="px-4 py-2.5 border-b border-border shrink-0">
          <DialogTitle className="flex items-center gap-2 text-[13.5px] font-semibold min-w-0">
            <FileText className="h-4 w-4 text-brand-600 dark:text-brand-400 shrink-0" />
            <span className="truncate">{fileName ?? "Aperçu du document"}</span>
            <span className="ml-auto flex items-center gap-2 shrink-0">
              {onSend && (
                <button type="button" onClick={onSend} className="inline-flex items-center gap-1 h-7 px-2.5 rounded-lg bg-brand-600 text-black text-[12px] font-semibold hover:bg-brand-700 transition-colors">
                  <Send className="h-3.5 w-3.5" /> Envoyer
                </button>
              )}
              {docId && (
                <a href={`/api/archive/${docId}/pdf`} download className="inline-flex items-center gap-1 h-7 px-2.5 rounded-lg border border-border text-[12px] font-medium text-muted-foreground hover:text-foreground hover:bg-secondary/60 transition-colors" title="Télécharger le PDF">
                  <Download className="h-3.5 w-3.5" /> Télécharger
                </a>
              )}
            </span>
          </DialogTitle>
          <DialogDescription className="sr-only">Aperçu du PDF du document.</DialogDescription>
        </DialogHeader>
        {docId && open && (
          <iframe src={`/api/archive/${docId}/pdf`} title="Aperçu du PDF" className="flex-1 w-full bg-white" />
        )}
      </DialogContent>
    </Dialog>
  );
}
