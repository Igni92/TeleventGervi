"use client";

import * as React from "react";
import { Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

/**
 * <ConfirmDialog /> — confirmation modale sur le Dialog existant : annuler
 * (outline) et confirmer (filled ou destructive) côte à côte, pleine largeur.
 * Remplaçant unique des window.confirm.
 */

export interface ConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: React.ReactNode;
  description?: React.ReactNode;
  confirmLabel: React.ReactNode;
  cancelLabel?: React.ReactNode;
  /** destructive : bouton de confirmation en aplat --destructive. */
  tone?: "default" | "destructive";
  /** Peut être async : le dialog gère l'état d'attente et se ferme au succès. */
  onConfirm: () => void | Promise<void>;
  /** Force l'état chargement depuis l'extérieur (mutation pilotée par le parent). */
  loading?: boolean;
}

function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  cancelLabel = "Annuler",
  tone = "default",
  onConfirm,
  loading,
}: ConfirmDialogProps) {
  const [pending, setPending] = React.useState(false);
  const busy = Boolean(loading) || pending;

  const handleConfirm = async () => {
    setPending(true);
    try {
      // Ne se ferme QU'EN cas de succès : une erreur remonte au parent et
      // laisse le dialog ouvert pour retenter.
      await onConfirm();
      onOpenChange(false);
    } finally {
      setPending(false);
    }
  };

  return (
    <Dialog
      open={open}
      // Pendant l'attente, la fermeture (Échap, clic sur le voile) est bloquée
      // pour ne pas perdre le retour de l'action en cours.
      onOpenChange={(next) => {
        if (busy && !next) return;
        onOpenChange(next);
      }}
    >
      <DialogContent
        size="sm"
        // Sans description, Radix avertit sur aria-describedby : neutralisé.
        {...(description == null ? { "aria-describedby": undefined } : {})}
      >
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description != null && (
            <DialogDescription>{description}</DialogDescription>
          )}
        </DialogHeader>
        {/* Deux colonnes égales pleine largeur — motif feuille de confirmation. */}
        <div className="grid grid-cols-2 gap-2">
          <Button
            variant="outline"
            disabled={busy}
            onClick={() => onOpenChange(false)}
          >
            {cancelLabel}
          </Button>
          <Button
            variant={tone === "destructive" ? "destructive" : "default"}
            disabled={busy}
            onClick={handleConfirm}
          >
            {busy && <Loader2 className="animate-spin" aria-hidden="true" />}
            {confirmLabel}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
ConfirmDialog.displayName = "ConfirmDialog";

export { ConfirmDialog };
