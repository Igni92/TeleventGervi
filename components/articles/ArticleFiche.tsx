"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  Loader2, Save, Package, Boxes, Barcode, Tag, Ruler, Euro, Layers,
  Warehouse, MessageSquare, Wheat, AlertTriangle,
} from "lucide-react";
import { SectionCard } from "@/components/clients/SectionCard";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";

/** Champs ÉDITABLES (miroir du bloc `fields` renvoyé par l'API). Tout est géré en
 *  chaîne côté formulaire ; les nombres sont convertis à l'envoi. */
type FormFields = {
  itemName: string;
  variete: string;
  barCode: string;
  purchaseUnit: string;
  salesUnit: string;
  inventoryUnit: string;
  salesPackagingUnit: string;
  salesQtyPerPackUnit: string;
  salesUnitWeight: string;
  uPays: string;
  uMarque: string;
  uCondi: string;
  uCalibre: string;
  uUvc: string;
  uNbBarqColis: string;
  commentaire: string;
};

interface ArticleData {
  itemCode: string;
  sapLive: boolean;
  groupName: string | null;
  totalStock: number;
  stockByWarehouse: Record<string, { inStock: number; committed: number; ordered: number; available: number }>;
  prixAchat: number | null;
  prixAchatCurrency: string | null;
  manageBatch: boolean;
  fields: Record<string, unknown>;
}

interface Batch {
  batchNumber: string;
  warehouseCode: string | null;
  expirationDate: string | null;
  admissionDate: string | null;
  purchasePrice: number | null;
  currency: string | null;
  supplierName: string | null;
  sourceDocNum: string | null;
  status: string | null;
}

const numStr = (v: unknown): string => (v === null || v === undefined || v === "" ? "" : String(v));
const str = (v: unknown): string => (typeof v === "string" ? v : "");

function toForm(fields: Record<string, unknown>): FormFields {
  return {
    itemName: str(fields.itemName),
    variete: str(fields.variete),
    barCode: str(fields.barCode),
    purchaseUnit: str(fields.purchaseUnit),
    salesUnit: str(fields.salesUnit),
    inventoryUnit: str(fields.inventoryUnit),
    salesPackagingUnit: str(fields.salesPackagingUnit),
    salesQtyPerPackUnit: numStr(fields.salesQtyPerPackUnit),
    salesUnitWeight: numStr(fields.salesUnitWeight),
    uPays: str(fields.uPays),
    uMarque: str(fields.uMarque),
    uCondi: str(fields.uCondi),
    uCalibre: str(fields.uCalibre),
    uUvc: str(fields.uUvc),
    uNbBarqColis: numStr(fields.uNbBarqColis),
    commentaire: str(fields.commentaire),
  };
}

const fmtDate = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("fr-FR") : "—");
const fmtEur = (v: number | null, cur: string | null) =>
  v == null ? "—" : `${v.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${cur || "€"}`;

export function ArticleFiche({ id, canEdit }: { id: string; canEdit: boolean }) {
  const [data, setData] = useState<ArticleData | null>(null);
  const [batches, setBatches] = useState<Batch[]>([]);
  const [form, setForm] = useState<FormFields | null>(null);
  const [initial, setInitial] = useState<FormFields | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [dRes, bRes] = await Promise.all([
        fetch(`/api/products/${id}`, { cache: "no-store" }),
        fetch(`/api/products/${id}/batches`, { cache: "no-store" }),
      ]);
      const d = await dRes.json();
      if (!dRes.ok) throw new Error(d?.error || "Chargement impossible");
      setData(d);
      const f = toForm(d.fields ?? {});
      setForm(f);
      setInitial(f);
      const b = await bRes.json().catch(() => ({ batches: [] }));
      setBatches(b.batches ?? []);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Chargement impossible");
    } finally { setLoading(false); }
  }, [id]);

  useEffect(() => { load(); }, [load]);

  const set = (k: keyof FormFields, v: string) => setForm((cur) => (cur ? { ...cur, [k]: v } : cur));

  const dirty = useMemo(() => {
    if (!form || !initial) return false;
    return (Object.keys(form) as (keyof FormFields)[]).some((k) => form[k] !== initial[k]);
  }, [form, initial]);

  const save = async () => {
    if (!form) return;
    if (!form.itemName.trim()) { toast.error("Le nom de l'article est obligatoire."); return; }
    setSaving(true);
    try {
      const body = {
        ...form,
        salesQtyPerPackUnit: form.salesQtyPerPackUnit === "" ? null : Number(form.salesQtyPerPackUnit),
        salesUnitWeight: form.salesUnitWeight === "" ? null : Number(form.salesUnitWeight),
        uNbBarqColis: form.uNbBarqColis === "" ? null : Number(form.uNbBarqColis),
      };
      const res = await fetch(`/api/products/${id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error || "Enregistrement échoué");
      if (json.sapOk === false) {
        toast.warning("Enregistré en local, mais l'écriture SAP a échoué", { description: json.sapError || undefined });
      } else {
        toast.success("Article enregistré", { description: json.message });
      }
      setInitial(form);
      // Recharge pour refléter les valeurs canoniques SAP.
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Enregistrement échoué");
    } finally { setSaving(false); }
  };

  if (loading || !form || !data) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const warehouses = Object.entries(data.stockByWarehouse || {});

  return (
    <div className="space-y-5 pb-24">
      {!data.sapLive && (
        <div className="flex items-center gap-2 rounded-xl border border-amber-400/50 bg-amber-500/10 px-4 py-2.5 text-[12.5px] text-amber-800 dark:text-amber-200">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          SAP momentanément injoignable — affichage du cache local. L&apos;enregistrement retentera l&apos;écriture SAP.
        </div>
      )}

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        {/* Identité */}
        <SectionCard accent="brand" title="Identité" subtitle="Désignation · variété · code-barres · marque · origine" icon={<Tag />} className="lg:col-span-2">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Désignation (nom SAP)" required>
              <Input value={form.itemName} onChange={(e) => set("itemName", e.target.value)} disabled={!canEdit} />
            </Field>
            <Field label="Variété (nom étranger)">
              <Input value={form.variete} onChange={(e) => set("variete", e.target.value)} disabled={!canEdit} placeholder="ex. Gariguette" />
            </Field>
            <Field label="EAN13 / code-barres" hint="Champ SAP BarCode">
              <div className="relative">
                <Barcode className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                <Input value={form.barCode} onChange={(e) => set("barCode", e.target.value)} disabled={!canEdit} className="pl-8 font-mono" placeholder="3xxxxxxxxxxxx" inputMode="numeric" />
              </div>
            </Field>
            <Field label="Marque">
              <Input value={form.uMarque} onChange={(e) => set("uMarque", e.target.value)} disabled={!canEdit} />
            </Field>
            <Field label="Pays d'origine">
              <Input value={form.uPays} onChange={(e) => set("uPays", e.target.value)} disabled={!canEdit} placeholder="ex. France" />
            </Field>
            <Field label="Calibre">
              <div className="relative">
                <Ruler className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                <Input value={form.uCalibre} onChange={(e) => set("uCalibre", e.target.value)} disabled={!canEdit} className="pl-8" placeholder="ex. 3AE" />
              </div>
            </Field>
          </div>
        </SectionCard>

        {/* Conditionnement */}
        <SectionCard accent="sky" title="Conditionnement" subtitle="Unités achat / vente / stockage · emballage · poids" icon={<Layers />} className="lg:col-span-2">
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
            <Field label="Unité d'ACHAT" hint="PurchaseUnit">
              <Input value={form.purchaseUnit} onChange={(e) => set("purchaseUnit", e.target.value)} disabled={!canEdit} placeholder="ex. Colis" />
            </Field>
            <Field label="Unité de VENTE" hint="SalesUnit">
              <Input value={form.salesUnit} onChange={(e) => set("salesUnit", e.target.value)} disabled={!canEdit} placeholder="ex. pie" />
            </Field>
            <Field label="Unité de STOCKAGE" hint="InventoryUOM">
              <Input value={form.inventoryUnit} onChange={(e) => set("inventoryUnit", e.target.value)} disabled={!canEdit} placeholder="ex. pie" />
            </Field>
            <Field label="Conditionnement détaillé" hint="U_GER_Det_Condt">
              <Input value={form.uCondi} onChange={(e) => set("uCondi", e.target.value)} disabled={!canEdit} placeholder="ex. 12x125g" />
            </Field>
            <Field label="Emballage de vente" hint="SalesPackagingUnit">
              <Input value={form.salesPackagingUnit} onChange={(e) => set("salesPackagingUnit", e.target.value)} disabled={!canEdit} placeholder="ex. Barquette" />
            </Field>
            <Field label="Qté / emballage" hint="SalesQtyPerPackUnit">
              <Input value={form.salesQtyPerPackUnit} onChange={(e) => set("salesQtyPerPackUnit", e.target.value)} disabled={!canEdit} inputMode="decimal" placeholder="ex. 12" />
            </Field>
            <Field label="Poids unité (kg)" hint="SalesUnitWeight">
              <Input value={form.salesUnitWeight} onChange={(e) => set("salesUnitWeight", e.target.value)} disabled={!canEdit} inputMode="decimal" placeholder="ex. 0.125" />
            </Field>
            <Field label="UVC" hint="U_GER_UVC">
              <Input value={form.uUvc} onChange={(e) => set("uUvc", e.target.value)} disabled={!canEdit} placeholder="ex. 125g" />
            </Field>
            <Field label="Nb barquettes / colis" hint="U_GER_NB_BARQ_COLIS">
              <Input value={form.uNbBarqColis} onChange={(e) => set("uNbBarqColis", e.target.value)} disabled={!canEdit} inputMode="decimal" placeholder="ex. 10" />
            </Field>
          </div>
        </SectionCard>

        {/* Prix & stock (lecture seule) */}
        <SectionCard accent="emerald" title="Prix & stock" subtitle="Dernier prix d'achat · stock par entrepôt (lecture SAP)" icon={<Euro />}>
          <div className="space-y-4">
            <div className="flex items-center justify-between rounded-xl border border-border bg-secondary/30 px-4 py-3">
              <span className="inline-flex items-center gap-2 text-[13px] font-medium text-muted-foreground"><Euro className="h-4 w-4" /> Dernier prix d&apos;achat</span>
              <span className="text-[18px] font-bold tnum text-foreground">{fmtEur(data.prixAchat, data.prixAchatCurrency)}</span>
            </div>
            <div className="flex items-center justify-between rounded-xl border border-border bg-secondary/30 px-4 py-3">
              <span className="inline-flex items-center gap-2 text-[13px] font-medium text-muted-foreground"><Package className="h-4 w-4" /> Stock total</span>
              <span className="text-[18px] font-bold tnum text-foreground">{Math.round(data.totalStock)}</span>
            </div>
            <div>
              <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Par entrepôt</p>
              {warehouses.length === 0 ? (
                <p className="text-[12.5px] italic text-muted-foreground">Aucun stock enregistré.</p>
              ) : (
                <ul className="space-y-1.5">
                  {warehouses.map(([wh, s]) => (
                    <li key={wh} className="flex items-center justify-between rounded-lg border border-border bg-card px-3 py-2 text-[12.5px]">
                      <span className="inline-flex items-center gap-1.5 font-medium"><Warehouse className="h-3.5 w-3.5 text-muted-foreground" /> {wh}</span>
                      <span className="flex items-center gap-3 tnum">
                        <span className="text-emerald-700 dark:text-emerald-400 font-semibold">{Math.round(s.available)} dispo</span>
                        <span className="text-muted-foreground">{Math.round(s.inStock)} phys.</span>
                        {s.ordered > 0 && <span className="text-sky-600 dark:text-sky-400">{Math.round(s.ordered)} cde</span>}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </SectionCard>

        {/* Lots en stock (lecture seule) */}
        <SectionCard accent="amber" title="Lots en stock" subtitle="Lots valables (DLC) · prix & fournisseur d'entrée" icon={<Wheat />}>
          {batches.length === 0 ? (
            <p className="text-[12.5px] italic text-muted-foreground">Aucun lot enregistré pour cet article.</p>
          ) : (
            <ul className="space-y-2 max-h-[360px] overflow-auto pr-1">
              {batches.map((b) => (
                <li key={`${b.batchNumber}-${b.warehouseCode ?? ""}`} className="rounded-lg border border-border bg-card p-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono text-[12.5px] font-semibold">{b.batchNumber}</span>
                    {b.expirationDate && (
                      <span className="text-[11.5px] text-muted-foreground">DLC {fmtDate(b.expirationDate)}</span>
                    )}
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11.5px] text-muted-foreground">
                    {b.purchasePrice != null && <span className="font-semibold text-foreground">{fmtEur(b.purchasePrice, b.currency)}</span>}
                    {b.supplierName && <span className="truncate">{b.supplierName}</span>}
                    {b.sourceDocNum && <span className="font-mono">BR {b.sourceDocNum}</span>}
                    {b.warehouseCode && <span>· {b.warehouseCode}</span>}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </SectionCard>

        {/* Commentaire interne */}
        <SectionCard accent="violet" title="Commentaire interne" subtitle="Note libre — n'est PAS envoyée à SAP" icon={<MessageSquare />} className="lg:col-span-2">
          <Textarea
            value={form.commentaire}
            onChange={(e) => set("commentaire", e.target.value)}
            disabled={!canEdit}
            rows={4}
            placeholder="Remarques, historique, alertes qualité, conditions particulières…"
          />
        </SectionCard>
      </div>

      {/* Barre d'enregistrement */}
      {canEdit && (
        <div className="sticky bottom-3 z-30 flex items-center justify-end gap-3 rounded-xl border border-border bg-card/95 px-4 py-3 shadow-modal backdrop-blur">
          <span className="mr-auto text-[12.5px] text-muted-foreground">
            {dirty ? "Modifications non enregistrées" : "À jour"}
            <span className="mx-2 text-border">·</span>
            <span className="inline-flex items-center gap-1"><Boxes className="h-3.5 w-3.5" /> écriture SAP ({data.itemCode})</span>
          </span>
          <Button type="button" onClick={save} disabled={saving || !dirty}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            Enregistrer
          </Button>
        </div>
      )}
    </div>
  );
}

function Field({ label, hint, required, children }: { label: string; hint?: string; required?: boolean; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label className="flex items-center gap-1.5 text-[12.5px]">
        {label} {required && <span className="text-destructive">*</span>}
        {hint && <span className="font-mono text-[10px] font-normal text-muted-foreground/60">{hint}</span>}
      </Label>
      {children}
    </div>
  );
}
