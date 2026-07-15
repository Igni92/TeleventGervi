"use client";

import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, Search, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { TypeCombobox } from "@/components/TypeCombobox";
import { supplierSchema, type SupplierFormValues } from "@/lib/validations";

interface SupplierFormProps {
  initialData?: SupplierFormValues & { id?: string; active?: boolean };
  mode: "create" | "edit";
}

type SapVendor = { cardCode: string; cardName: string; email: string | null; phone: string | null };

/** Autocomplete fournisseur SAP (BusinessPartner CardType=V) — sert à
 *  PRÉ-REMPLIR la fiche à la création (code, nom, email, tél.). */
function SapVendorPicker({ onPick }: { onPick: (v: SapVendor) => void }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SapVendor[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const t = setTimeout(async () => {
      if (!query.trim()) { setResults([]); return; }
      setLoading(true);
      try {
        const res = await fetch(`/api/sap/suppliers?q=${encodeURIComponent(query.trim())}`);
        const json = await res.json();
        setResults(json.suppliers ?? []);
      } catch { setResults([]); }
      finally { setLoading(false); }
    }, 240);
    return () => clearTimeout(t);
  }, [query]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  return (
    <div className="relative" ref={boxRef}>
      <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
      <Input
        value={query}
        onFocus={() => setOpen(true)}
        onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
        placeholder="Rechercher un fournisseur SAP (code ou nom)…"
        className="pl-9"
      />
      {loading && <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 animate-spin text-muted-foreground" />}
      {open && results.length > 0 && (
        <ul className="absolute z-20 mt-1 w-full rounded-lg border border-border bg-popover shadow-modal max-h-72 overflow-auto">
          {results.map((v) => (
            <li key={v.cardCode}>
              <button
                type="button"
                onClick={() => { onPick(v); setQuery(""); setOpen(false); }}
                className="w-full text-left px-3 py-2 hover:bg-secondary/60 transition-colors"
              >
                <div className="text-[13px] font-medium">{v.cardName}</div>
                <div className="text-[11px] text-muted-foreground font-mono">{v.cardCode}</div>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function SupplierForm({ initialData, mode }: SupplierFormProps) {
  const router = useRouter();
  const [sapLinked, setSapLinked] = useState<boolean>(!!initialData?.sapCardCode);

  const {
    register,
    handleSubmit,
    setValue,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<SupplierFormValues>({
    resolver: zodResolver(supplierSchema),
    defaultValues: {
      code: initialData?.code || "",
      nom: initialData?.nom || "",
      type: initialData?.type || "",
      sapCardCode: initialData?.sapCardCode || "",
      email: initialData?.email || "",
      tel1: initialData?.tel1 || "",
      tel2: initialData?.tel2 || "",
      tel3: initialData?.tel3 || "",
      adresse: initialData?.adresse || "",
      notes: initialData?.notes || "",
    },
  });

  const typeValue = watch("type");
  const sapCardCode = watch("sapCardCode");

  const prefillFromSap = (v: SapVendor) => {
    // On ne remplit que les champs vides (ne pas écraser une saisie en cours).
    setValue("sapCardCode", v.cardCode, { shouldValidate: true });
    if (!watch("code")) setValue("code", v.cardCode, { shouldValidate: true });
    if (!watch("nom")) setValue("nom", v.cardName, { shouldValidate: true });
    if (!watch("email") && v.email) setValue("email", v.email);
    if (!watch("tel1") && v.phone) setValue("tel1", v.phone);
    setSapLinked(true);
    toast.success("Fournisseur SAP rattaché", { description: `${v.cardName} · ${v.cardCode}` });
  };

  const onSubmit = async (data: SupplierFormValues) => {
    try {
      const url = mode === "edit" && initialData?.id ? `/api/suppliers/${initialData.id}` : "/api/suppliers";
      const method = mode === "edit" ? "PUT" : "POST";
      const response = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw new Error(error.error || "Une erreur est survenue");
      }
      const saved = await response.json();
      toast.success(mode === "create" ? "Fournisseur créé" : "Fournisseur mis à jour");
      if (mode === "create") {
        router.push(`/fournisseurs/${saved.id}`);
      } else {
        router.refresh();
      }
    } catch (error: unknown) {
      toast.error(error instanceof Error ? error.message : "Une erreur est survenue");
    }
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
      {/* Pré-remplissage depuis SAP (création uniquement) */}
      {mode === "create" && (
        <div className="space-y-2 rounded-xl border border-dashed border-border bg-secondary/30 p-4">
          <Label className="text-[12.5px]">Depuis un fournisseur SAP (facultatif)</Label>
          <SapVendorPicker onPick={prefillFromSap} />
          <p className="text-[11.5px] text-muted-foreground">
            Rattache la fiche à un tiers SAP (CardType=V) et pré-remplit code, nom, email et téléphone.
            Vous pouvez aussi tout saisir à la main.
          </p>
        </div>
      )}

      <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
        {/* Code */}
        <div className="space-y-2">
          <Label htmlFor="code">
            Code fournisseur <span className="text-red-500">*</span>
          </Label>
          <Input
            id="code"
            placeholder="EX: FRS001 ou CardCode SAP"
            {...register("code")}
            disabled={mode === "edit"}
            className={errors.code ? "border-red-500" : ""}
          />
          {errors.code && <p className="text-sm text-red-500">{errors.code.message}</p>}
        </div>

        {/* Nom */}
        <div className="space-y-2">
          <Label htmlFor="nom">
            Nom du fournisseur <span className="text-red-500">*</span>
          </Label>
          <Input
            id="nom"
            placeholder="Raison sociale"
            {...register("nom")}
            className={errors.nom ? "border-red-500" : ""}
          />
          {errors.nom && <p className="text-sm text-red-500">{errors.nom.message}</p>}
        </div>

        {/* Famille / type d'achat */}
        <div className="space-y-2">
          <Label>Famille d&apos;achat</Label>
          <TypeCombobox
            kind="supplier-type"
            value={typeValue || null}
            onChange={(v) => setValue("type", v)}
            placeholder="Fruits, Emballage, Transport…"
            className="w-full"
          />
        </div>

        {/* Lien SAP */}
        <div className="space-y-2">
          <Label htmlFor="sapCardCode">CardCode SAP</Label>
          <div className="relative">
            <Input
              id="sapCardCode"
              placeholder="Non rattaché"
              {...register("sapCardCode")}
              className="font-mono"
            />
            {sapCardCode && (
              <button
                type="button"
                onClick={() => { setValue("sapCardCode", ""); setSapLinked(false); }}
                title="Détacher du fournisseur SAP"
                className="absolute right-2 top-1/2 -translate-y-1/2 h-6 w-6 inline-flex items-center justify-center rounded text-muted-foreground/50 hover:text-rose-500"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
          {sapLinked && <p className="text-[11.5px] text-emerald-600 dark:text-emerald-400">Rattaché à SAP · les achats restent gérés dans SAP.</p>}
        </div>

        {/* Email */}
        <div className="space-y-2">
          <Label htmlFor="email">Email</Label>
          <Input
            id="email"
            type="email"
            placeholder="contact@fournisseur.fr"
            {...register("email")}
            className={errors.email ? "border-red-500" : ""}
          />
          {errors.email && <p className="text-sm text-red-500">{errors.email.message}</p>}
        </div>

        {/* Standard */}
        <div className="space-y-2">
          <Label htmlFor="tel1">Standard</Label>
          <Input id="tel1" placeholder="Standard téléphonique" {...register("tel1")} className={errors.tel1 ? "border-red-500" : ""} />
          {errors.tel1 && <p className="text-sm text-red-500">{errors.tel1.message}</p>}
        </div>

        {/* Direct 1 */}
        <div className="space-y-2">
          <Label htmlFor="tel2">Direct 1</Label>
          <Input id="tel2" placeholder="Ligne directe 1" {...register("tel2")} className={errors.tel2 ? "border-red-500" : ""} />
          {errors.tel2 && <p className="text-sm text-red-500">{errors.tel2.message}</p>}
        </div>

        {/* Direct 2 */}
        <div className="space-y-2">
          <Label htmlFor="tel3">Direct 2</Label>
          <Input id="tel3" placeholder="Ligne directe 2" {...register("tel3")} className={errors.tel3 ? "border-red-500" : ""} />
          {errors.tel3 && <p className="text-sm text-red-500">{errors.tel3.message}</p>}
        </div>
      </div>

      {/* Adresse */}
      <div className="space-y-2">
        <Label htmlFor="adresse">Adresse</Label>
        <Textarea id="adresse" placeholder="Siège / dépôt fournisseur…" rows={2} {...register("adresse")} className={errors.adresse ? "border-red-500" : ""} />
        {errors.adresse && <p className="text-sm text-red-500">{errors.adresse.message}</p>}
      </div>

      {/* Notes */}
      <div className="space-y-2">
        <Label htmlFor="notes">Notes</Label>
        <Textarea id="notes" placeholder="Conditions, remarques, historique…" rows={4} {...register("notes")} className={errors.notes ? "border-red-500" : ""} />
        {errors.notes && <p className="text-sm text-red-500">{errors.notes.message}</p>}
      </div>

      {/* Actions */}
      <div className="flex items-center gap-3 pt-2">
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          {mode === "create" ? "Créer le fournisseur" : "Enregistrer les modifications"}
        </Button>
        <Button type="button" variant="outline" onClick={() => router.back()} disabled={isSubmitting}>
          Annuler
        </Button>
      </div>
    </form>
  );
}
