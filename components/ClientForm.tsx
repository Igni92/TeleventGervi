"use client";

import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ClientGroupEditor } from "@/components/clients/ClientGroupEditor";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { clientSchema, type ClientFormValues } from "@/lib/validations";

const JOURS = [
  { label: "Lun", value: 1 },
  { label: "Mar", value: 2 },
  { label: "Mer", value: 3 },
  { label: "Jeu", value: 4 },
  { label: "Ven", value: 5 },
  { label: "Sam", value: 6 },
  { label: "Dim", value: 0 },
];

interface UserOption {
  id: string;
  name: string | null;
  email: string | null;
}

interface ClientFormProps {
  initialData?: ClientFormValues & {
    id?: string;
    sapGroupCode?: number | null;
    sapGroupName?: string | null;
  };
  mode: "create" | "edit";
}

export function ClientForm({ initialData, mode }: ClientFormProps) {
  const router = useRouter();
  const [commerciaux, setCommerciaux] = useState<UserOption[]>([]);

  useEffect(() => {
    fetch("/api/users")
      .then((r) => r.json())
      .then((d) => setCommerciaux(d.users || []))
      .catch(() => {});
  }, []);

  const {
    register,
    handleSubmit,
    setValue,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<ClientFormValues>({
    resolver: zodResolver(clientSchema),
    defaultValues: {
      code: initialData?.code || "",
      nom: initialData?.nom || "",
      type: initialData?.type as "EXPORT" | "GMS" | "CHR" | undefined,
      commercial: initialData?.commercial || "",
      tel1: initialData?.tel1 || "",
      tel2: initialData?.tel2 || "",
      tel3: initialData?.tel3 || "",
      email: initialData?.email || "",
      notes: initialData?.notes || "",
      joursAppel: initialData?.joursAppel || [],
    },
  });

  const typeValue = watch("type");
  const commercialValue = watch("commercial");
  const joursAppelValue = watch("joursAppel") || [];

  const toggleJour = (val: number) => {
    const current = joursAppelValue;
    if (current.includes(val)) {
      setValue("joursAppel", current.filter((j) => j !== val));
    } else {
      setValue("joursAppel", [...current, val]);
    }
  };

  const onSubmit = async (data: ClientFormValues) => {
    try {
      const url =
        mode === "edit" && initialData?.id
          ? `/api/clients/${initialData.id}`
          : "/api/clients";

      const method = mode === "edit" ? "PUT" : "POST";

      const response = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...data,
          commercial: data.commercial || undefined,
          tel1: data.tel1 || undefined,
          tel2: data.tel2 || undefined,
          tel3: data.tel3 || undefined,
          email: data.email || undefined,
          notes: data.notes || undefined,
        }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || "Une erreur est survenue");
      }

      toast.success(
        mode === "create" ? "Client créé avec succès" : "Client mis à jour avec succès"
      );
      router.push("/clients");
      router.refresh();
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Une erreur est survenue";
      toast.error(message);
    }
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
      <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
        {/* Code client */}
        <div className="space-y-2">
          <Label htmlFor="code">
            Code client <span className="text-red-500">*</span>
          </Label>
          <Input
            id="code"
            placeholder="EX: CLI001"
            {...register("code")}
            disabled={mode === "edit"}
            className={errors.code ? "border-red-500" : ""}
          />
          {errors.code && (
            <p className="text-sm text-red-500">{errors.code.message}</p>
          )}
        </div>

        {/* Nom */}
        <div className="space-y-2">
          <Label htmlFor="nom">
            Nom du client <span className="text-red-500">*</span>
          </Label>
          <Input
            id="nom"
            placeholder="Nom du client"
            {...register("nom")}
            className={errors.nom ? "border-red-500" : ""}
          />
          {errors.nom && (
            <p className="text-sm text-red-500">{errors.nom.message}</p>
          )}
        </div>

        {/* Type */}
        <div className="space-y-2">
          <Label>Type</Label>
          <Select
            value={typeValue || "NONE"}
            onValueChange={(val) =>
              setValue("type", val === "NONE" ? undefined : (val as "EXPORT" | "GMS" | "CHR"))
            }
          >
            <SelectTrigger className={errors.type ? "border-red-500" : ""}>
              <SelectValue placeholder="Sélectionner un type" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="NONE">— Aucun —</SelectItem>
              <SelectItem value="EXPORT">EXPORT</SelectItem>
              <SelectItem value="GMS">GMS</SelectItem>
              <SelectItem value="CHR">CHR</SelectItem>
            </SelectContent>
          </Select>
          {errors.type && (
            <p className="text-sm text-red-500">{errors.type.message}</p>
          )}
        </div>

        {/* Commercial */}
        <div className="space-y-2">
          <Label>Commercial</Label>
          <Select
            value={commercialValue || "NONE"}
            onValueChange={(val) => setValue("commercial", val === "NONE" ? "" : val)}
          >
            <SelectTrigger className={errors.commercial ? "border-red-500" : ""}>
              <SelectValue placeholder="Assigner un commercial" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="NONE">— Aucun —</SelectItem>
              {commerciaux.map((u) => {
                const label = u.name || u.email || u.id;
                return (
                  <SelectItem key={u.id} value={label}>
                    {label}
                  </SelectItem>
                );
              })}
            </SelectContent>
          </Select>
          {errors.commercial && (
            <p className="text-sm text-red-500">{errors.commercial.message}</p>
          )}
        </div>

        {/* Standard (tel1) */}
        <div className="space-y-2">
          <Label htmlFor="tel1">Standard</Label>
          <Input
            id="tel1"
            placeholder="Standard téléphonique"
            {...register("tel1")}
            className={errors.tel1 ? "border-red-500" : ""}
          />
          {errors.tel1 && (
            <p className="text-sm text-red-500">{errors.tel1.message}</p>
          )}
        </div>

        {/* Direct 1 (tel2) */}
        <div className="space-y-2">
          <Label htmlFor="tel2">Direct 1</Label>
          <Input
            id="tel2"
            placeholder="Ligne directe 1"
            {...register("tel2")}
            className={errors.tel2 ? "border-red-500" : ""}
          />
          {errors.tel2 && (
            <p className="text-sm text-red-500">{errors.tel2.message}</p>
          )}
        </div>

        {/* Direct 2 (tel3) */}
        <div className="space-y-2">
          <Label htmlFor="tel3">Direct 2</Label>
          <Input
            id="tel3"
            placeholder="Ligne directe 2"
            {...register("tel3")}
            className={errors.tel3 ? "border-red-500" : ""}
          />
          {errors.tel3 && (
            <p className="text-sm text-red-500">{errors.tel3.message}</p>
          )}
        </div>

        {/* B7 : l'email général est retiré — il vit maintenant sur Contact
            (une fiche par interlocuteur, cf. ContactsEditor). Le champ
            `email` reste dans le shape du formulaire pour ne pas casser le
            POST/PATCH (legacy) mais n'est plus éditable ici. */}
        <input type="hidden" {...register("email")} />

        {/* Groupe SAP — éditable (écrit le GroupCode dans SAP, pilote les coefs prix) */}
        {mode === "edit" && initialData?.id ? (
          <ClientGroupEditor
            clientId={initialData.id}
            initialCode={initialData.sapGroupCode ?? null}
            initialName={initialData.sapGroupName ?? null}
          />
        ) : (
          <div className="space-y-2">
            <Label>Groupe SAP</Label>
            <div className="h-9 px-3 inline-flex items-center gap-2 rounded-md border border-dashed border-border bg-secondary/40 text-[13px]">
              <span className="italic text-muted-foreground">disponible après création</span>
            </div>
          </div>
        )}
      </div>

      {/* Jours d'appel */}
      <div className="space-y-3">
        <Label>Jours d&apos;appel</Label>
        <div className="flex gap-2 flex-wrap">
          {JOURS.map(({ label, value }) => {
            const active = joursAppelValue.includes(value);
            return (
              <button
                key={value}
                type="button"
                onClick={() => toggleJour(value)}
                className={`h-9 w-12 rounded-lg border text-sm font-medium transition-all duration-150 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:ring-offset-1 dark:focus:ring-offset-slate-900 ${
                  active
                    ? "border-brand-500 bg-brand-500 text-white shadow-[0_2px_10px_-2px_hsl(var(--brand-500))]"
                    : "bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 border-slate-300 dark:border-slate-600 hover:border-brand-400 hover:text-brand-600 dark:hover:border-brand-500 dark:hover:text-brand-400"
                }`}
              >
                {label}
              </button>
            );
          })}
        </div>
        <p className="text-xs text-slate-400 dark:text-slate-500">
          Sélectionnez les jours auxquels ce client doit être appelé.
        </p>
      </div>

      {/* Les jours de LIVRAISON vivent désormais dans l'onglet Logistique
          (DeliveryDaysEditor) — décochables pour les clients non livrés. */}

      {/* Notes */}
      <div className="space-y-2">
        <Label htmlFor="notes">Notes</Label>
        <Textarea
          id="notes"
          placeholder="Notes libres sur ce client..."
          rows={4}
          {...register("notes")}
          className={errors.notes ? "border-red-500" : ""}
        />
        {errors.notes && (
          <p className="text-sm text-red-500">{errors.notes.message}</p>
        )}
      </div>

      {/* Actions */}
      <div className="flex items-center gap-3 pt-2">
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          {mode === "create" ? "Créer le client" : "Enregistrer les modifications"}
        </Button>
        <Button
          type="button"
          variant="outline"
          onClick={() => router.back()}
          disabled={isSubmitting}
        >
          Annuler
        </Button>
      </div>
    </form>
  );
}
