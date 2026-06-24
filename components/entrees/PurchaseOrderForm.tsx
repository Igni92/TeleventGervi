"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Loader2, Trash2, PackageCheck, CheckCircle2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { NumberInput } from "@/components/ui/number-input";
import { Button } from "@/components/ui/button";
import { SurfaceCard } from "@/components/ui/surface-card";
import { DateStepper, todayISO } from "@/components/ui/date-stepper";
import { designationProduit } from "@/lib/produit-designation";
import { DesignationChips } from "./DesignationChips";
import { SupplierPicker, ProductPicker, type Supplier, type ProductHit } from "./GoodsReceiptForm";

const fmtEur = (n: number) => n.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " €";

type Line = {
  itemCode: string; itemName: string; ratio: number;
  packageQuantity: number; warehouseCode: "000" | "01" | "R1"; price: string;
  pays: string | null; marque: string | null; condt: string | null; variete: string | null;
};
const WAREHOUSES: { code: "000" | "01" | "R1"; label: string }[] = [
  { code: "000", label: "000 · A/C-A/D" },
  { code: "01", label: "01 · Stock" },
  { code: "R1", label: "R1 · J+1" },
];

export function PurchaseOrderForm({ onCreated }: { onCreated?: () => void }) {
  const [supplier, setSupplier] = useState<Supplier | null>(null);
  const [dueDate, setDueDate] = useState(todayISO());
  const [numAtCard, setNumAtCard] = useState("");
  const [comment, setComment] = useState("");
  const [lines, setLines] = useState<Line[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [last, setLast] = useState<number | null>(null);

  const addLine = (p: ProductHit) => setLines((cur) => {
    if (cur.some((l) => l.itemCode === p.itemCode)) { toast.info(`${p.itemCode} déjà dans la liste`); return cur; }
    const ratio = (p.salesQtyPerPackUnit && p.salesQtyPerPackUnit > 1) ? p.salesQtyPerPackUnit : 1;
    return [...cur, { itemCode: p.itemCode, itemName: p.itemName, ratio, packageQuantity: 1, warehouseCode: "01", price: "", pays: p.uPays, marque: p.uMarque, condt: p.uCondi, variete: p.frgnName }];
  });
  const updateLine = (i: number, patch: Partial<Line>) => setLines((c) => c.map((l, k) => k === i ? { ...l, ...patch } : l));
  const removeLine = (i: number) => setLines((c) => c.filter((_, k) => k !== i));
  const totalHT = lines.reduce((s, l) => { const p = l.price === "" ? null : parseFloat(l.price); return s + (p != null ? p * l.packageQuantity * l.ratio : 0); }, 0);
  const reset = () => { setSupplier(null); setNumAtCard(""); setComment(""); setLines([]); setDueDate(todayISO()); };

  const submit = async () => {
    if (!supplier) { toast.error("Sélectionne un fournisseur"); return; }
    if (lines.length === 0) { toast.error("Ajoute au moins 1 ligne"); return; }
    if (!dueDate) { toast.error("Date de livraison prévue requise"); return; }
    setSubmitting(true); setLast(null);
    try {
      const res = await fetch("/api/sap/purchase-orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          cardCode: supplier.cardCode, dueDate, numAtCard: numAtCard.trim() || undefined, comment: comment.trim() || undefined,
          lines: lines.map((l) => ({ itemCode: l.itemCode, packageQuantity: l.packageQuantity, warehouseCode: l.warehouseCode, price: l.price ? parseFloat(l.price) : undefined })),
        }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) { toast.error(json.error || "Erreur SAP"); return; }
      toast.success(`Commande fournisseur #${json.docNum} créée`, { description: `Livraison prévue le ${new Date(dueDate).toLocaleDateString("fr-FR")}` });
      setLast(json.docNum); reset(); onCreated?.();
    } catch (e) {
      toast.error((e as Error).message);
    } finally { setSubmitting(false); }
  };

  return (
    <SurfaceCard accent="violet" className="p-5 space-y-5">
      <div className="flex items-center gap-2">
        <PackageCheck className="h-4 w-4 text-muted-foreground" />
        <h2 className="text-[15px] font-semibold">Nouvelle commande fournisseur</h2>
      </div>

      {last && (
        <div className="flex items-center gap-2 rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-[13px] text-emerald-700 dark:text-emerald-300">
          <CheckCircle2 className="h-4 w-4 shrink-0" />
          <span>Dernière commande créée : <b>#{last}</b>.</span>
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <label className="text-[11px] uppercase tracking-wide text-muted-foreground font-semibold">Fournisseur</label>
          <SupplierPicker value={supplier} onChange={setSupplier} />
        </div>
        <div className="space-y-1.5">
          <label className="text-[11px] uppercase tracking-wide text-muted-foreground font-semibold">Livraison prévue</label>
          <DateStepper value={dueDate} onChange={setDueDate} />
        </div>
      </div>

      <div className="space-y-1.5">
        <label className="text-[11px] uppercase tracking-wide text-muted-foreground font-semibold">Référence (optionnel)</label>
        <Input value={numAtCard} onChange={(e) => setNumAtCard(e.target.value)} placeholder="N° interne / réf. fournisseur" />
      </div>

      <div className="space-y-1.5">
        <label className="text-[11px] uppercase tracking-wide text-muted-foreground font-semibold">Ajouter un article</label>
        <ProductPicker onPick={addLine} />
      </div>

      {/* Mobile : cartes */}
      {lines.length > 0 && (
        <div className="md:hidden space-y-2.5">
          {lines.map((l, i) => {
            const pieceQty = l.packageQuantity * l.ratio;
            const dz = designationProduit({ itemName: l.itemName, uPays: l.pays, uMarque: l.marque, uCondi: l.condt, frgnName: l.variete });
            const priceNum = l.price === "" ? null : parseFloat(l.price);
            const lineHT = priceNum != null ? priceNum * pieceQty : null;
            return (
              <div key={l.itemCode} className="rounded-xl border border-border bg-card/40 p-3 space-y-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="text-[15px] font-semibold text-foreground leading-tight">{dz.fruit}</div>
                    <div className="text-[12px] font-mono text-muted-foreground mt-0.5">{l.itemCode}</div>
                    <DesignationChips marque={dz.marque} condt={dz.condt} calibre={dz.variete} pays={dz.pays} className="mt-1.5" />
                  </div>
                  <Button variant="ghost" size="icon-sm" tabIndex={-1} onClick={() => removeLine(i)} aria-label="Supprimer"><Trash2 className="h-4 w-4" /></Button>
                </div>
                <div className="grid grid-cols-2 gap-2.5">
                  <div>
                    <label className="block text-[11px] uppercase tracking-wide text-muted-foreground font-semibold mb-1">Qté (colis)</label>
                    <NumberInput value={l.packageQuantity} onValueChange={(n) => updateLine(i, { packageQuantity: n ?? 0 })} min={0} step={1} className="h-11 w-full text-right text-[15px]" />
                  </div>
                  <div>
                    <label className="block text-[11px] uppercase tracking-wide text-muted-foreground font-semibold mb-1">Prix /pie HT</label>
                    <NumberInput value={priceNum} onValueChange={(n) => updateLine(i, { price: n == null ? "" : String(n) })} min={0} step={0.01} decimals={2} allowEmpty placeholder="—" className="h-11 w-full text-right text-[15px]" />
                  </div>
                </div>
                <div className="flex items-end justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <label className="block text-[11px] uppercase tracking-wide text-muted-foreground font-semibold mb-1">Entrepôt</label>
                    <select value={l.warehouseCode} onChange={(e) => updateLine(i, { warehouseCode: e.target.value as Line["warehouseCode"] })} tabIndex={-1} className="h-11 w-full rounded-md border border-input bg-background px-2 text-[14px]">
                      {WAREHOUSES.map((w) => <option key={w.code} value={w.code}>{w.label}</option>)}
                    </select>
                  </div>
                  <div className="text-right shrink-0">
                    <span className="block text-[11px] uppercase tracking-wide text-muted-foreground font-semibold">Total HT</span>
                    <span className="text-[18px] font-bold tnum text-foreground">{lineHT != null ? fmtEur(lineHT) : "—"}</span>
                  </div>
                </div>
              </div>
            );
          })}
          <div className="flex items-center justify-between px-1 pt-1 border-t border-border">
            <span className="text-[12px] uppercase tracking-wide font-semibold text-muted-foreground">Total HT</span>
            <span className="text-[20px] font-bold tnum text-foreground">{fmtEur(totalHT)}</span>
          </div>
        </div>
      )}

      {/* Desktop : tableau */}
      {lines.length > 0 && (
        <div className="hidden md:block rounded-lg border border-border overflow-x-auto">
          <table className="w-full text-[12.5px]">
            <thead className="bg-secondary/40 text-[10.5px] uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="text-left px-2 py-2 font-semibold w-24">Qté</th>
                <th className="text-left px-2 py-2 font-semibold w-28">Code</th>
                <th className="text-left px-2 py-2 font-semibold">Fruit</th>
                <th className="text-left px-2 py-2 font-semibold">Pays</th>
                <th className="text-left px-2 py-2 font-semibold">Marque</th>
                <th className="text-left px-2 py-2 font-semibold">Variété</th>
                <th className="text-left px-2 py-2 font-semibold">Condt</th>
                <th className="text-left px-2 py-2 font-semibold w-36">Entrepôt</th>
                <th className="text-right px-2 py-2 font-semibold w-24">Prix /pie HT</th>
                <th className="text-right px-2 py-2 font-semibold w-24">Total HT</th>
                <th className="w-8" />
              </tr>
            </thead>
            <tbody>
              {lines.map((l, i) => {
                const pieceQty = l.packageQuantity * l.ratio;
                const dz = designationProduit({ itemName: l.itemName, uPays: l.pays, uMarque: l.marque, uCondi: l.condt, frgnName: l.variete });
                const priceNum = l.price === "" ? null : parseFloat(l.price);
                const lineHT = priceNum != null ? priceNum * pieceQty : null;
                return (
                  <tr key={l.itemCode} className="border-t border-border">
                    <td className="px-2 py-2"><NumberInput value={l.packageQuantity} onValueChange={(n) => updateLine(i, { packageQuantity: n ?? 0 })} min={0} step={1} className="text-right h-9 w-20" /></td>
                    <td className="px-2 py-2 font-mono">{l.itemCode}</td>
                    <td className="px-2 py-2 text-foreground">{dz.fruit}</td>
                    <td className="px-2 py-2 text-muted-foreground">{dz.pays}</td>
                    <td className="px-2 py-2 text-muted-foreground">{dz.marque}</td>
                    <td className="px-2 py-2 text-muted-foreground">{dz.variete}</td>
                    <td className="px-2 py-2 text-muted-foreground">{dz.condt}</td>
                    <td className="px-2 py-2">
                      <select value={l.warehouseCode} onChange={(e) => updateLine(i, { warehouseCode: e.target.value as Line["warehouseCode"] })} tabIndex={-1} className="h-9 w-full rounded-md border border-input bg-background px-2 text-[12.5px]">
                        {WAREHOUSES.map((w) => <option key={w.code} value={w.code}>{w.label}</option>)}
                      </select>
                    </td>
                    <td className="px-2 py-2"><NumberInput value={priceNum} onValueChange={(n) => updateLine(i, { price: n == null ? "" : String(n) })} min={0} step={0.01} decimals={2} allowEmpty placeholder="—" className="text-right h-9 w-24" /></td>
                    <td className="px-2 py-2 text-right tnum font-medium whitespace-nowrap">{lineHT != null ? fmtEur(lineHT) : <span className="text-muted-foreground/60">—</span>}</td>
                    <td className="px-2 py-2 text-right"><Button variant="ghost" size="icon-sm" tabIndex={-1} onClick={() => removeLine(i)} aria-label="Supprimer"><Trash2 className="h-3.5 w-3.5" /></Button></td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="border-t border-border bg-secondary/30">
                <td colSpan={9} className="px-2 py-2 text-right text-[10.5px] uppercase tracking-wide font-semibold text-muted-foreground">Total HT</td>
                <td className="px-2 py-2 text-right tnum font-bold text-foreground whitespace-nowrap">{fmtEur(totalHT)}</td>
                <td />
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      <div className="space-y-1.5">
        <label className="text-[11px] uppercase tracking-wide text-muted-foreground font-semibold">Commentaire (optionnel)</label>
        <Input value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Note libre — visible sur la commande SAP" />
      </div>

      <div className="flex items-center justify-end gap-2 pt-2 border-t border-border">
        <Button variant="ghost" onClick={reset} disabled={submitting}>Vider</Button>
        <Button onClick={submit} disabled={submitting || !supplier || lines.length === 0}>
          {submitting ? <Loader2 className="animate-spin" /> : <PackageCheck />}
          {submitting ? "Création SAP…" : "Créer la commande"}
        </Button>
      </div>
    </SurfaceCard>
  );
}
