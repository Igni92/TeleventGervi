"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Loader2, Factory, CheckCircle2, RefreshCw } from "lucide-react";
import { Input } from "@/components/ui/input";
import { NumberInput } from "@/components/ui/number-input";
import { Button } from "@/components/ui/button";
import { SurfaceCard } from "@/components/ui/surface-card";
import { Donut } from "@/components/charts/Donut";

type Kit = { itemCode: string; itemName: string; salesUnit: string | null; salesQtyPerPackUnit: number | null };
type Component = {
  itemCode: string; itemName: string; salesUnit: string | null;
  qtyPerParent: number; purchasePrice: number | null; lineCost: number;
};

const WAREHOUSES = [
  { code: "000", label: "000 · A/C-A/D" },
  { code: "01",  label: "01 · Stock" },
  { code: "R1",  label: "R1 · J+1" },
] as const;

export function FabricationForm() {
  const [kits, setKits] = useState<Kit[]>([]);
  const [parent, setParent] = useState<string>("");
  const [packageQuantity, setPackageQuantity] = useState(1);
  const [warehouse, setWarehouse] = useState<"000" | "01" | "R1">("01");
  const [bom, setBom] = useState<Component[]>([]);
  const [loadingBom, setLoadingBom] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [lastResult, setLastResult] = useState<{ exit: number; entry: number; cost: number } | null>(null);

  // Charge la liste des kits
  const loadKits = useCallback(async () => {
    try {
      const res = await fetch("/api/products/bom?list=true", { cache: "no-store" });
      const json = await res.json();
      setKits(json.kits ?? []);
    } catch {
      setKits([]);
    }
  }, []);

  useEffect(() => { loadKits(); }, [loadKits]);

  // Charge la BoM dès qu'un parent est sélectionné
  useEffect(() => {
    let cancel = false;
    if (!parent) { setBom([]); return; }
    setLoadingBom(true);
    (async () => {
      try {
        const res = await fetch(`/api/products/bom?parentItemCode=${encodeURIComponent(parent)}`, { cache: "no-store" });
        const json = await res.json();
        if (!cancel) setBom(json.components ?? []);
      } catch {
        if (!cancel) setBom([]);
      } finally {
        if (!cancel) setLoadingBom(false);
      }
    })();
    return () => { cancel = true; };
  }, [parent]);

  const parentMeta = kits.find((k) => k.itemCode === parent);
  const parentRatio = (parentMeta?.salesQtyPerPackUnit && parentMeta.salesQtyPerPackUnit > 1)
    ? parentMeta.salesQtyPerPackUnit : 1;
  const parentPieceQty = packageQuantity * parentRatio;

  // Coût total = somme(qtyPerParent × purchasePrice) × pieceParent
  const totalCost = bom.reduce((s, c) => s + (c.purchasePrice ?? 0) * c.qtyPerParent * parentPieceQty, 0);
  const costPerPackage = packageQuantity > 0 ? totalCost / packageQuantity : 0;

  const submit = async () => {
    if (!parent) { toast.error("Choisis un produit à fabriquer"); return; }
    if (packageQuantity <= 0) { toast.error("Quantité > 0 requise"); return; }
    if (bom.length === 0) { toast.error("Aucune recette définie"); return; }
    setSubmitting(true);
    setLastResult(null);
    try {
      const res = await fetch("/api/sap/assembly", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ parentItemCode: parent, packageQuantity, warehouseCode: warehouse }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        toast.error(json.error || "Erreur SAP");
        return;
      }
      toast.success(`${json.opCode} · Fabriqué ${packageQuantity} colis ${parent}`, {
        description: `Exit #${json.sapExitDocNum} · Entry #${json.sapEntryDocNum} · Coût ${json.totalCost.toFixed(2)} €`,
        duration: 10000,
      });
      setLastResult({ exit: json.sapExitDocNum, entry: json.sapEntryDocNum, cost: json.totalCost });
      setPackageQuantity(1);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <SurfaceCard accent="brand" className="p-5 space-y-5">
      {lastResult && (
        <div className="flex items-center gap-2 rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-[13px] text-emerald-700 dark:text-emerald-300">
          <CheckCircle2 className="h-4 w-4 shrink-0" />
          <span>Dernière fab : Exit # {lastResult.exit} · Entry # {lastResult.entry} · Coût {lastResult.cost.toFixed(2)} €</span>
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-3">
        <div className="space-y-1.5">
          <label className="text-[11px] uppercase tracking-wide text-muted-foreground font-semibold">Produit à fabriquer</label>
          <select
            value={parent}
            onChange={(e) => setParent(e.target.value)}
            className="h-10 w-full rounded-md border border-input bg-background px-3 text-[13px]"
          >
            <option value="">— Choisir un kit —</option>
            {kits.map((k) => (
              <option key={k.itemCode} value={k.itemCode}>
                {k.itemName} ({k.itemCode})
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1.5">
          <label className="text-[11px] uppercase tracking-wide text-muted-foreground font-semibold">Quantité (colis)</label>
          <NumberInput
            value={packageQuantity}
            onValueChange={(n) => setPackageQuantity(n ?? 0)}
            min={1} step={1}
          />
          {parentRatio > 1 && (
            <p className="text-[10.5px] text-muted-foreground">= {parentPieceQty} pie</p>
          )}
        </div>
        <div className="space-y-1.5">
          <label className="text-[11px] uppercase tracking-wide text-muted-foreground font-semibold">Entrepôt</label>
          <select
            value={warehouse}
            onChange={(e) => setWarehouse(e.target.value as typeof warehouse)}
            className="h-10 w-full rounded-md border border-input bg-background px-3 text-[13px]"
          >
            {WAREHOUSES.map((w) => <option key={w.code} value={w.code}>{w.label}</option>)}
          </select>
        </div>
      </div>

      {parent && bom.length > 0 && totalCost > 0 && (
        <div className="rounded-lg border border-border bg-card/40 p-4">
          <p className="text-[11px] uppercase tracking-wide text-muted-foreground font-semibold mb-3">
            Répartition du coût matière
          </p>
          <Donut
            size={132}
            thickness={15}
            centerValue={`${totalCost.toFixed(0)} €`}
            centerLabel="coût"
            data={bom
              .filter((c) => (c.purchasePrice ?? 0) > 0)
              .map((c) => ({
                label: c.itemName,
                value: (c.purchasePrice ?? 0) * c.qtyPerParent * parentPieceQty,
              }))}
            aria-label="Part de chaque composant dans le coût matière"
          />
        </div>
      )}

      {parent && (
        <div className="rounded-lg border border-border overflow-hidden">
          <div className="px-3 py-2 bg-secondary/40 flex items-center justify-between">
            <p className="text-[11px] uppercase tracking-wide text-muted-foreground font-semibold">
              Recette pour {packageQuantity} colis ({parentPieceQty} pie)
            </p>
            <Button variant="ghost" size="sm" onClick={() => setParent((p) => p)} disabled={loadingBom}>
              {loadingBom ? <Loader2 className="animate-spin" /> : <RefreshCw />}
            </Button>
          </div>
          {bom.length === 0 ? (
            <p className="text-[12px] italic text-muted-foreground p-4 text-center">
              {loadingBom ? "Chargement…" : "Aucune recette définie pour ce produit. Configure-la ci-dessous."}
            </p>
          ) : (
            <table className="w-full text-[13px]">
              <thead className="text-[11px] uppercase tracking-wide text-muted-foreground">
                <tr className="border-t border-border">
                  <th className="text-left px-3 py-2 font-semibold">Composant</th>
                  <th className="text-right px-3 py-2 font-semibold w-24">Qté pie</th>
                  <th className="text-right px-3 py-2 font-semibold w-28">Prix achat €</th>
                  <th className="text-right px-3 py-2 font-semibold w-28">Coût ligne €</th>
                </tr>
              </thead>
              <tbody>
                {bom.map((c) => {
                  const qty = c.qtyPerParent * parentPieceQty;
                  const cost = (c.purchasePrice ?? 0) * qty;
                  return (
                    <tr key={c.itemCode} className="border-t border-border">
                      <td className="px-3 py-2">
                        <div className="font-medium">{c.itemName}</div>
                        <div className="text-[11px] text-muted-foreground font-mono">{c.itemCode}</div>
                      </td>
                      <td className="px-3 py-2 text-right tnum">{qty.toFixed(qty < 10 ? 1 : 0)}</td>
                      <td className="px-3 py-2 text-right tnum text-muted-foreground">
                        {c.purchasePrice != null ? c.purchasePrice.toFixed(2) : "—"}
                      </td>
                      <td className="px-3 py-2 text-right tnum font-semibold">
                        {c.purchasePrice != null ? cost.toFixed(2) : "—"}
                      </td>
                    </tr>
                  );
                })}
                <tr className="border-t-2 border-border bg-secondary/30">
                  <td colSpan={3} className="px-3 py-2 text-right font-semibold">
                    Coût total · {costPerPackage.toFixed(2)} €/colis
                  </td>
                  <td className="px-3 py-2 text-right tnum font-bold text-[14px]">
                    {totalCost.toFixed(2)} €
                  </td>
                </tr>
              </tbody>
            </table>
          )}
        </div>
      )}

      <div className="flex items-center justify-end gap-2 pt-2 border-t border-border">
        <Button onClick={submit} disabled={submitting || !parent || bom.length === 0 || packageQuantity <= 0}>
          {submitting ? <Loader2 className="animate-spin" /> : <Factory />}
          {submitting ? "Fabrication…" : "Lancer la fabrication"}
        </Button>
      </div>
    </SurfaceCard>
  );
}
