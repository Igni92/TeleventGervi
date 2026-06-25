"use client";

import { useState, useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { Bell, CalendarIcon, CheckCircle, Loader2, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Separator } from "@/components/ui/separator";
import { rappelSchema, type RappelFormValues } from "@/lib/validations";
import { formatDate, formatDateInput } from "@/lib/utils";
import { formatPhoneDisplay } from "@/lib/phone";

interface Rappel {
  id: string;
  dateRappel: string;
  note?: string | null;
  statut: string;
  msEventId?: string | null;
}

interface Client {
  id: string;
  nom: string;
  code: string;
  tel1?: string | null;
  tel2?: string | null;
  tel3?: string | null;
  rappels?: Rappel[];
}

interface ReminderModalProps {
  client: Client;
  onReminderCreated?: () => void;
  /** Optional controlled open state. If omitted, the modal renders its own trigger button. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

const statutVariant: Record<string, "planifie" | "fait" | "annule"> = {
  PLANIFIE: "planifie",
  FAIT: "fait",
  ANNULE: "annule",
};

const statutLabel: Record<string, string> = {
  PLANIFIE: "Planifié",
  FAIT: "Fait",
  ANNULE: "Annulé",
};

export function ReminderModal({
  client, onReminderCreated, open: openProp, onOpenChange,
}: ReminderModalProps) {
  const [internalOpen, setInternalOpen] = useState(false);
  const isControlled = openProp !== undefined;
  const open = isControlled ? openProp : internalOpen;
  const setOpen = (v: boolean) => {
    if (isControlled) onOpenChange?.(v);
    else setInternalOpen(v);
  };
  const [rappels, setRappels] = useState<Rappel[]>(client.rappels || []);
  const [loadingStatut, setLoadingStatut] = useState<string | null>(null);

  // Min datetime: now + 5 minutes
  const minDateTime = formatDateInput(new Date(Date.now() + 5 * 60 * 1000));

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<RappelFormValues>({
    resolver: zodResolver(rappelSchema),
    defaultValues: {
      clientId: client.id,
      dateRappel: "",
      note: "",
    },
  });

  const loadRappels = async () => {
    try {
      const res = await fetch(`/api/reminders?clientId=${client.id}`);
      if (res.ok) {
        const data = await res.json();
        setRappels(data);
      }
    } catch {
      // silent
    }
  };

  const onSubmit = async (data: RappelFormValues) => {
    try {
      const response = await fetch("/api/reminders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || "Erreur lors de la création du rappel");
      }

      toast.success("Rappel créé et ajouté à votre calendrier Microsoft");
      reset({ clientId: client.id, dateRappel: "", note: "" });
      await loadRappels();
      onReminderCreated?.();
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Une erreur est survenue";
      toast.error(message);
    }
  };

  const updateStatut = async (rappelId: string, statut: string) => {
    setLoadingStatut(rappelId);
    try {
      const response = await fetch("/api/reminders", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: rappelId, statut }),
      });

      if (!response.ok) {
        throw new Error("Erreur lors de la mise à jour");
      }

      toast.success(statut === "FAIT" ? "Rappel marqué comme fait" : "Rappel annulé");
      await loadRappels();
    } catch {
      toast.error("Erreur lors de la mise à jour du rappel");
    } finally {
      setLoadingStatut(null);
    }
  };

  // When opened (any mode), refresh rappels list
  useEffect(() => {
    if (open) loadRappels();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => setOpen(o)}
    >
      {!isControlled && (
        <DialogTrigger asChild>
          <Button variant="outline" size="sm" className="gap-1">
            <Bell className="h-3.5 w-3.5" />
            Rappel
          </Button>
        </DialogTrigger>
      )}

      <DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Bell className="h-5 w-5 text-brand-600 dark:text-brand-400" />
            Rappel pour {client.nom}
          </DialogTitle>
          <DialogDescription>
            Code : <strong>{client.code}</strong>
            {client.tel1 && <> &bull; {formatPhoneDisplay(client.tel1)}</>}
            {client.tel2 && ` / ${formatPhoneDisplay(client.tel2)}`}
            {client.tel3 && ` / ${formatPhoneDisplay(client.tel3)}`}
          </DialogDescription>
        </DialogHeader>

        {/* Formulaire nouveau rappel */}
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <input type="hidden" {...register("clientId")} value={client.id} />

          <div className="space-y-2">
            <Label htmlFor="dateRappel">
              Date et heure du rappel <span className="text-red-500">*</span>
            </Label>
            <Input
              id="dateRappel"
              type="datetime-local"
              min={minDateTime}
              {...register("dateRappel")}
              className={errors.dateRappel ? "border-red-500" : ""}
            />
            {errors.dateRappel && (
              <p className="text-sm text-red-500">{errors.dateRappel.message}</p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="note">Note (optionnelle)</Label>
            <Textarea
              id="note"
              placeholder="Objet de l'appel, informations importantes..."
              rows={3}
              {...register("note")}
            />
          </div>

          <Button
            type="submit"
            disabled={isSubmitting}
            className="w-full"
          >
            {isSubmitting ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Création en cours...
              </>
            ) : (
              <>
                <CalendarIcon className="mr-2 h-4 w-4" />
                Créer le rappel
              </>
            )}
          </Button>
        </form>

        {/* Historique des rappels */}
        {rappels.length > 0 && (
          <>
            <Separator className="my-2" />
            <div>
              <h4 className="text-sm font-semibold mb-3 text-muted-foreground uppercase tracking-wide">
                Historique des rappels
              </h4>
              <div className="space-y-2 max-h-60 overflow-y-auto pr-1">
                {rappels.map((rappel) => (
                  <div
                    key={rappel.id}
                    className="flex items-start justify-between gap-2 rounded-md border p-3 bg-muted/30"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <Badge variant={statutVariant[rappel.statut] || "outline"}>
                          {statutLabel[rappel.statut] || rappel.statut}
                        </Badge>
                        <span className="text-xs text-muted-foreground">
                          {formatDate(rappel.dateRappel)}
                        </span>
                      </div>
                      {rappel.note && (
                        <p className="text-sm text-foreground truncate">{rappel.note}</p>
                      )}
                    </div>

                    {rappel.statut === "PLANIFIE" && (
                      <div className="flex gap-1 shrink-0">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 w-7 p-0 text-green-600 hover:text-green-700 hover:bg-green-50 dark:text-green-400 dark:hover:text-green-300 dark:hover:bg-green-900/20"
                          onClick={() => updateStatut(rappel.id, "FAIT")}
                          disabled={loadingStatut === rappel.id}
                          title="Marquer comme fait"
                        >
                          {loadingStatut === rappel.id ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <CheckCircle className="h-3.5 w-3.5" />
                          )}
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 w-7 p-0 text-red-500 hover:text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:text-red-300 dark:hover:bg-red-900/20"
                          onClick={() => updateStatut(rappel.id, "ANNULE")}
                          disabled={loadingStatut === rappel.id}
                          title="Annuler"
                        >
                          <XCircle className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
