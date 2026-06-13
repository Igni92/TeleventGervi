"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Loader2, Plus, Trash2, Save, Search, Settings } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { SurfaceCard } from "@/components/ui/surface-card";

type ProductHit = { id: string; itemCode: string; itemName: string };
type BomLine = { itemCode: string; itemName: string; qtyPerParent: number };

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

/** Combobox produit générique (search /api/products). */
function ProductPicker({ label, placeholder, onPick }: {
  label: string; placeholder: string; onPick: (p: ProductHit) => void;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<ProductHit[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const debounced = useDebounced(query, 220);
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let cancel = false;
    if (!debounced.trim()) { setResults([]); return; }
    (async () => {
      setLoading(true);
      try {
        const r = await fetch(`/api/products?search=${encodeURIComponent(debounced)}&limit=8`);
        const j = await r.json();
        if (!cancel) setResults(j.products ?? []);
      } catch {
        if (!cancel) setResults([]);
      } finally {
        if (!cancel) setLoading(false);
      }
    })();
    return () => { cancel = true; };
  }, [debounced]);

  return (
    <div className="space-y-1.5">
      <label className="text-[11px] uppercase tracking-wide text-muted-foreground font-semibold">{label}</label>
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
        <Input
          ref={ref}
          value={query}
          onFocus={() => setOpen(true)}
          onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
          placeholder={placeholder}
          className="pl-9"
        />
        {loading && <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 animate-spin text-muted-foreground" />}
        {open && results.length > 0 && (
          <ul className="absolute z-10 mt-1 w-full rounded-lg border border-border bg-popover shadow-modal max-h-72 overflow-auto">
            {results.map((p) => (
              <li key={p.id}>
                <button
                  type="button"
                  onClick={() => { onPick(p); setQuery(""); setOpen(false); ref.current?.focus(); }}
                  className="w-full text-left px-3 py-2 hover:bg-secondary/60 transition-colors"
                >
                  <div className="text-[13px] font-medium truncate">{p.itemName}</div>
                  <div className="text-[11px] text-muted-foreground font-mono">{p.itemCode}</div>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

export function BomAdmin() {
  const [parent, setParent] = useState<ProductHit | null>(null);
  const [lines, setLines] = useState<BomLine[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  const loadBom = useCallback(async (parentCode: string) => {
    setLoading(true);
    try {
      const r = await fetch(`/api/products/bom?parentItemCode=${encodeURIComponent(parentCode)}`, { cache: "no-store" });
      const j = await r.json();
      setLines((j.components ?? []).map((c: { itemCode: string; itemName: string; qtyPerParent: number }) => ({
        itemCode: c.itemCode, itemName: c.itemName, qtyPerParent: c.qtyPerParent,
      })));
    } catch {
      setLines([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (parent) loadBom(parent.itemCode);
    else setLines([]);
  }, [parent, loadBom]);

  const addComponent = (p: ProductHit) => {
    if (parent?.itemCode === p.itemCode) {
      toast.error("Le composant ne peut pas être le parent lui-même");
      return;
    }
    setLines((cur) => {
      if (cur.some((l) => l.itemCode === p.itemCode)) {
        toast.info(`${p.itemCode} déjà dans la recette`);
        return cur;
      }
      return [...cur, { itemCode: p.itemCode, itemName: p.itemName, qtyPerParent: 1 }];
    });
  };
  const updateQty = (i: number, qty: number) =>
    setLines((c) => c.map((l, k) => k === i ? { ...l, qtyPerParent: qty } : l));
  const removeLine = (i: number) => setLines((c) => c.filter((_, k) => k !== i));

  const save = async () => {
    if (!parent) { toast.error("Choisis un parent"); return; }
    for (const l of lines) {
      if (!l.qtyPerParent || l.qtyPerParent <= 0) {
        toast.error(`Qté invalide sur ${l.itemCode}`); return;
      }
    }
    setSaving(true);
    try {
      const r = await fetch("/api/products/bom", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          parentItemCode: parent.itemCode,
          components: lines.map((l) => ({ componentItemCode: l.itemCode, qtyPerParent: l.qtyPerParent })),
        }),
      });
      const j = await r.json();
      if (!r.ok || !j.ok) { toast.error(j.error || "Erreur"); return; }
      toast.success(`Recette ${parent.itemCode} sauvegardée — ${j.count} composant(s)`);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <SurfaceCard accent="violet" className="p-5 space-y-5">
      <div className="flex items-center gap-2">
        <Settings className="h-4 w-4 text-muted-foreground" />
        <h2 className="text-[15px] font-semibold">Recettes — admin</h2>
      </div>
      <p className="text-[12px] text-muted-foreground">
        Définis ici la nomenclature d&apos;un produit composite. Les quantités sont
        exprimées en <b>pie de composant par pie de parent</b> (ex. 1 DECO pie =
        6 GROSEILLE pie + 5 MURE pie + 5 MYRTILLE pie).
      </p>

      <div className="grid gap-4 sm:grid-cols-2">
        <ProductPicker
          label="Produit parent (le kit)"
          placeholder="ex. DECO, FRUIT..."
          onPick={setParent}
        />
        <ProductPicker
          label="Ajouter un composant"
          placeholder="Recherche un composant…"
          onPick={addComponent}
        />
      </div>

      {parent && (
        <div className="rounded-lg border border-border bg-card/50 px-3 py-2">
          <p className="text-[12px]">
            <span className="text-muted-foreground">Parent sélectionné : </span>
            <b>{parent.itemName}</b> <span className="font-mono text-[11px] text-muted-foreground">({parent.itemCode})</span>
            <button type="button" onClick={() => setParent(null)} className="ml-3 text-[11px] text-rose-500 hover:underline">
              Changer
            </button>
          </p>
        </div>
      )}

      {parent && (
        loading ? (
          <p className="text-[12px] italic text-muted-foreground">Chargement de la recette…</p>
        ) : lines.length === 0 ? (
          <p className="text-[12px] italic text-muted-foreground py-4 text-center">
            Aucun composant. Utilise le picker à droite pour en ajouter.
          </p>
        ) : (
          <div className="rounded-lg border border-border overflow-hidden">
            <table className="w-full text-[13px]">
              <thead className="bg-secondary/40 text-[11px] uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="text-left px-3 py-2 font-semibold">Composant</th>
                  <th className="text-right px-3 py-2 font-semibold w-32">Qté/parent (pie)</th>
                  <th className="w-10" />
                </tr>
              </thead>
              <tbody>
                {lines.map((l, i) => (
                  <tr key={l.itemCode} className="border-t border-border">
                    <td className="px-3 py-2">
                      <div className="font-medium">{l.itemName}</div>
                      <div className="text-[11px] text-muted-foreground font-mono">{l.itemCode}</div>
                    </td>
                    <td className="px-3 py-2">
                      <Input
                        type="number" min={0} step="any" inputMode="decimal"
                        value={l.qtyPerParent}
                        onChange={(e) => updateQty(i, parseFloat(e.target.value) || 0)}
                        className="text-right h-9"
                      />
                    </td>
                    <td className="px-2 py-2 text-right">
                      <Button variant="ghost" size="icon-sm" onClick={() => removeLine(i)} aria-label="Supprimer">
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      )}

      {parent && (
        <div className="flex justify-end gap-2 pt-2 border-t border-border">
          <Button onClick={save} disabled={saving || !parent}>
            {saving ? <Loader2 className="animate-spin" /> : <Save />}
            {saving ? "Sauvegarde…" : "Sauvegarder la recette"}
          </Button>
        </div>
      )}
    </SurfaceCard>
  );
}
