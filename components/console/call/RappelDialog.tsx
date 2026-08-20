"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { BellRing, Loader2 } from "lucide-react";
import { RappelDateField } from "@/components/RappelDateField";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import { formatDateInput, formatRappelDate } from "@/lib/utils";
import type { Client } from "./shared";

/* ── Rappel dialog ─────────────────────────────────────────── */
export function RappelDialog({
  open, onOpenChange, client, onCreated,
}: {
  open: boolean;
  onOpenChange: (b: boolean) => void;
  client: Client | null;
  onCreated: () => void;
}) {
  const [date, setDate] = useState("");
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (open) {
      // Défaut = aujourd'hui à 5h (posé par RappelDateField quand la valeur est vide).
      setDate("");
      setNote("");
    }
  }, [open]);

  const minDateTime = formatDateInput(new Date(Date.now() + 5 * 60 * 1000));

  const submit = async () => {
    if (!client) return;
    setSubmitting(true);
    try {
      const res = await fetch("/api/reminders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientId: client.id, dateRappel: date, note: note || undefined }),
      });
      if (!res.ok) throw new Error();
      toast.success(`Rappel ${formatRappelDate(date)} · ajouté au calendrier Microsoft`);
      onOpenChange(false);
      onCreated();
    } catch {
      toast.error("Erreur lors de la création du rappel");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-[18px] font-semibold tracking-tight">
            <BellRing className="h-5 w-5 text-brand-600 dark:text-brand-400" />
            Programmer un rappel
          </DialogTitle>
          <DialogDescription className="text-[12.5px] text-muted-foreground mt-1">
            Choisissez la date et l&apos;heure du rappel
            {client ? <> pour <span className="font-medium text-foreground">{client.nom}</span></> : null}.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 mt-2">
          <div className="space-y-2">
            <Label htmlFor="rdate">Date et heure</Label>
            {/* Saisie libre au clavier (« 17 » + Entrée → 17 du mois courant à 5h)
                ou sélecteur natif via l'icône ; la case affiche « MAR 17.08.26 05:00 ». */}
            <RappelDateField id="rdate" value={date} onChange={setDate} min={minDateTime} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="rnote">Note (facultatif)</Label>
            <Textarea
              id="rnote"
              rows={3}
              placeholder="Sujet, contexte de l'appel…"
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </div>
          <Button onClick={submit} disabled={submitting || !date} className="w-full">
            {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <>Créer le rappel</>}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
