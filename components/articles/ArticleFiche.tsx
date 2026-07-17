"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  Loader2, Save, Package, Boxes, Barcode, Tag, Ruler, Euro, Layers,
  Warehouse, MessageSquare, Wheat, AlertTriangle, ShoppingCart, Store,
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
  // Conditionnement d'ACHAT
  purchaseUnit: string;
  purchasePackagingUnit: string;
  purchaseQtyPerPackUnit: string;
  purchaseItemsPerUnit: string;
  // Conditionnement de VENTE
  salesUnit: string;
  salesPackagingUnit: string;
  salesQtyPerPackUnit: string;
  salesItemsPerUnit: string;
  salesUnitWeight: string;
  // Conditionnement de STOCKAGE
  inventoryUnit: string;
  // Attributs
  uPays: string;
  uMarque: string;
  uCondi: string;
  uCalibre: string;
  uUvc: string;
  uNbBarqColis: string;
  commentaire: string;
};

type Option = { value: string; label: string };
type UdfLists = { uCalibre?: Option[]; uPays?: Option[]; uMarque?: Option[] };

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
    purchasePackagingUnit: str(fields.purchasePackagingUnit),
    purchaseQtyPerPackUnit: numStr(fields.purchaseQtyPerPackUnit),
    purchaseItemsPerUnit: numStr(fields.purchaseItemsPerUnit),
    salesUnit: str(fields.salesUnit),
    salesPackagingUnit: str(fields.salesPackagingUnit),
    salesQtyPerPackUnit: numStr(fields.salesQtyPerPackUnit),
    salesItemsPerUnit: numStr(fields.salesItemsPerUnit),
    salesUnitWeight: numStr(fields.salesUnitWeight),
    inventoryUnit: str(fields.inventoryUnit),
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

const NUM_KEYS = new Set<keyof FormFields>([
  "purchaseQtyPerPackUnit", "purchaseItemsPerUnit", "salesQtyPerPackUnit", "salesItemsPerUnit", "salesUnitWeight", "uNbBarqColis",
]);

export function ArticleFiche({ id, canEdit }: { id: string; canEdit: boolean }) {
  const [data, setData] = useState<ArticleData | null>(null);
  const [batches, setBatches] = useState<Batch[]>([]);
  const [udf, setUdf] = useState<UdfLists>({});
  const [form, setForm] = useState<FormFields | null>(null);
  const [initial, setInitial] = useState<FormFields | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [dRes, bRes, uRes] = await Promise.all([
        fetch(`/api/products/${id}`, { cache: "no-store" }),
        fetch(`/api/products/${id}/batches`, { cache: "no-store" }),
        fetch(`/api/sap/item-udfs`, { cache: "no-store" }),
      ]);
      const d = await dRes.json();
      if (!dRes.ok) throw new Error(d?.error || "Chargement impossible");
      setData(d);
      const f = toForm(d.fields ?? {});
      setForm(f);
      setInitial(f);
      const b = await bRes.json().catch(() => ({ batches: [] }));
      setBatches(b.batches ?? []);
      const u = await uRes.json().catch(() => ({ fields: {} }));
      setUdf(u.fields ?? {});
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
      const body: Record<string, unknown> = { ...form };
      for (const k of NUM_KEYS) body[k] = form[k] === "" ? null : Number(form[k]);
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
      load(); // reflète les valeurs canoniques SAP
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
        <SectionCard accent="brand" title="Identité" subtitle="Désignation · variété · code-barres · marque · origine · calibre" icon={<Tag />} className="lg:col-span-2">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <Field label="Désignation (nom SAP)" required>
              <Input value={form.itemName} onChange={(e) => set("itemName", e.target.value)} disabled={!canEdit} />
            </Field>
            <Field label="Variété (nom étranger)">
              <Input value={form.variete} onChange={(e) => set("variete", e.target.value)} disabled={!canEdit} placeholder="ex. Gariguette" />
            </Field>
            <Field label="EAN13 / code-barres" hint="BarCode">
              <div className="relative">
                <Barcode className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                <Input value={form.barCode} onChange={(e) => set("barCode", e.target.value)} disabled={!canEdit} className="pl-8 font-mono" placeholder="3xxxxxxxxxxxx" inputMode="numeric" />
              </div>
            </Field>
            <Field label="Marque" hint="U_GER_Marque">
              <ChoiceOrText value={form.uMarque} onChange={(v) => set("uMarque", v)} options={udf.uMarque} disabled={!canEdit} placeholder="Marque" />
            </Field>
            <Field label="Origine / pays" hint="U_Pays">
              <ChoiceOrText value={form.uPays} onChange={(v) => set("uPays", v)} options={udf.uPays} disabled={!canEdit} placeholder="Pays d'origine" />
            </Field>
            <Field label="Calibre" hint="U_GER_CALIBRE">
              <div className="relative">
                <Ruler className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground z-10" />
                <ChoiceOrText value={form.uCalibre} onChange={(v) => set("uCalibre", v)} options={udf.uCalibre} disabled={!canEdit} placeholder="Calibre" className="pl-8" />
              </div>
            </Field>
          </div>
        </SectionCard>

        {/* Conditionnement — SAP distingue ACHAT / VENTE / STOCKAGE */}
        <SectionCard accent="sky" title="Conditionnement" subtitle="SAP distingue achat / vente / stockage — unité, emballage, quantités" icon={<Layers />} className="lg:col-span-2">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <Axis title="Achat" tone="amber" icon={<ShoppingCart className="h-3.5 w-3.5" />}>
              <Field label="Unité d'achat" hint="PurchaseUnit">
                <Input value={form.purchaseUnit} onChange={(e) => set("purchaseUnit", e.target.value)} disabled={!canEdit} placeholder="ex. Colis" />
              </Field>
              <Field label="Emballage d'achat" hint="PurchasePackagingUnit">
                <Input value={form.purchasePackagingUnit} onChange={(e) => set("purchasePackagingUnit", e.target.value)} disabled={!canEdit} placeholder="ex. Palette" />
              </Field>
              <Field label="Qté / emballage" hint="PurchaseQtyPerPackUnit">
                <Input value={form.purchaseQtyPerPackUnit} onChange={(e) => set("purchaseQtyPerPackUnit", e.target.value)} disabled={!canEdit} inputMode="decimal" placeholder="ex. 100" />
              </Field>
              <Field label="Unités / unité d'achat" hint="PurchaseItemsPerUnit">
                <Input value={form.purchaseItemsPerUnit} onChange={(e) => set("purchaseItemsPerUnit", e.target.value)} disabled={!canEdit} inputMode="decimal" placeholder="ex. 1" />
              </Field>
            </Axis>

            <Axis title="Vente" tone="brand" icon={<Store className="h-3.5 w-3.5" />}>
              <Field label="Unité de vente" hint="SalesUnit">
                <Input value={form.salesUnit} onChange={(e) => set("salesUnit", e.target.value)} disabled={!canEdit} placeholder="ex. pie" />
              </Field>
              <Field label="Emballage de vente" hint="SalesPackagingUnit">
                <Input value={form.salesPackagingUnit} onChange={(e) => set("salesPackagingUnit", e.target.value)} disabled={!canEdit} placeholder="ex. CAT I" />
              </Field>
              <Field label="Qté / emballage" hint="SalesQtyPerPackUnit">
                <Input value={form.salesQtyPerPackUnit} onChange={(e) => set("salesQtyPerPackUnit", e.target.value)} disabled={!canEdit} inputMode="decimal" placeholder="ex. 12" />
              </Field>
              <Field label="Unités / unité de vente" hint="SalesItemsPerUnit">
                <Input value={form.salesItemsPerUnit} onChange={(e) => set("salesItemsPerUnit", e.target.value)} disabled={!canEdit} inputMode="decimal" placeholder="ex. 1" />
              </Field>
              <Field label="Poids unité (kg)" hint="SalesUnitWeight">
                <Input value={form.salesUnitWeight} onChange={(e) => set("salesUnitWeight", e.target.value)} disabled={!canEdit} inputMode="decimal" placeholder="ex. 0.125" />
              </Field>
            </Axis>

            <Axis title="Stockage" tone="emerald" icon={<Warehouse className="h-3.5 w-3.5" />}>
              <Field label="Unité de stockage" hint="InventoryUOM">
                <Input value={form.inventoryUnit} onChange={(e) => set("inventoryUnit", e.target.value)} disabled={!canEdit} placeholder="ex. pie" />
              </Field>
              <div className="rounded-lg border border-dashed border-border/70 p-2.5 text-[11px] leading-relaxed text-muted-foreground">
                Le stockage utilise l&apos;unité d&apos;inventaire SAP. Le stock par entrepôt est dans « Prix &amp; stock ».
              </div>
            </Axis>
          </div>

          {/* Attributs de détail Gervifrais */}
          <div className="mt-4 grid grid-cols-2 gap-4 border-t border-border/60 pt-4 sm:grid-cols-4">
            <Field label="Conditionnement détaillé" hint="U_GER_Det_Condt">
              <Input value={form.uCondi} onChange={(e) => set("uCondi", e.target.value)} disabled={!canEdit} placeholder="ex. 12x125g" />
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
                  {warehouses.map(([wh, sv]) => (
                    <li key={wh} className="flex items-center justify-between rounded-lg border border-border bg-card px-3 py-2 text-[12.5px]">
                      <span className="inline-flex items-center gap-1.5 font-medium"><Warehouse className="h-3.5 w-3.5 text-muted-foreground" /> {wh}</span>
                      <span className="flex items-center gap-3 tnum">
                        <span className="text-emerald-700 dark:text-emerald-400 font-semibold">{Math.round(sv.available)} dispo</span>
                        <span className="text-muted-foreground">{Math.round(sv.inStock)} phys.</span>
                        {sv.ordered > 0 && <span className="text-sky-600 dark:text-sky-400">{Math.round(sv.ordered)} cde</span>}
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

/** Bloc « axe » du conditionnement (Achat / Vente / Stockage). */
function Axis({ title, tone, icon, children }: { title: string; tone: "amber" | "brand" | "emerald"; icon: React.ReactNode; children: React.ReactNode }) {
  const cls = {
    amber: "text-amber-600 dark:text-amber-400 bg-amber-500/10 ring-amber-500/20",
    brand: "text-brand-600 dark:text-brand-400 bg-brand-500/10 ring-brand-500/20",
    emerald: "text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 ring-emerald-500/20",
  }[tone];
  return (
    <div className="rounded-xl border border-border bg-secondary/20 p-3.5">
      <div className="mb-3 flex items-center gap-2">
        <span className={`inline-flex h-6 w-6 items-center justify-center rounded-md ring-1 ${cls}`}>{icon}</span>
        <span className="text-[13px] font-semibold text-foreground">{title}</span>
      </div>
      <div className="space-y-3">{children}</div>
    </div>
  );
}

/** Liste déroulante si des valeurs valides SAP existent, sinon champ texte libre.
 *  La valeur courante hors-liste est préservée (option « hors liste »). */
function ChoiceOrText({
  value, onChange, options, disabled, placeholder, className,
}: {
  value: string; onChange: (v: string) => void; options?: Option[]; disabled?: boolean; placeholder?: string; className?: string;
}) {
  if (options && options.length > 0) {
    const known = options.some((o) => o.value === value);
    return (
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        aria-label={placeholder}
        className={`h-9 w-full rounded-md border border-border bg-background text-[13px] px-2 focus:outline-none focus:ring-1 focus:ring-brand-500 disabled:opacity-60 ${className ?? ""}`}
      >
        <option value="">—</option>
        {value && !known && <option value={value}>{value} (hors liste)</option>}
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    );
  }
  return <Input value={value} onChange={(e) => onChange(e.target.value)} disabled={disabled} placeholder={placeholder} className={className} />;
}

function Field({ label, hint, required, children }: { label: string; hint?: string; required?: boolean; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label className="flex flex-wrap items-center gap-1.5 text-[12.5px]">
        {label} {required && <span className="text-destructive">*</span>}
        {hint && <span className="font-mono text-[10px] font-normal text-muted-foreground/60">{hint}</span>}
      </Label>
      {children}
    </div>
  );
}
