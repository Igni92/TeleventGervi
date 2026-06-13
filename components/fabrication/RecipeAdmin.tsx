"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Loader2, Plus, Trash2, Save, Search, Settings, Package, Euro } from "lucide-react";
import { Input } from "@/components/ui/input";
import { NumberInput } from "@/components/ui/number-input";
import { Button } from "@/components/ui/button";
import { SurfaceCard } from "@/components/ui/surface-card";

type ProductHit = { id: string; itemCode: string; itemName: string };
type Family = { familyKey: string; familyLabel: string; productCount: number };
type ComponentLine = { familyKey: string; familyLabel: string; qtyColis: number };
type CostLine = { label: string; costPerColis: number };

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

/** Combobox produit (parent fabriqué). */
function ProductPicker({ placeholder, onPick }: { placeholder: string; onPick: (p: ProductHit) => void }) {
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
      } catch { if (!cancel) setResults([]); }
      finally { if (!cancel) setLoading(false); }
    })();
    return () => { cancel = true; };
  }, [debounced]);

  return (
    <div className="relative">
      <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
      <Input
        ref={ref} value={query}
        onFocus={() => setOpen(true)}
        onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
        placeholder={placeholder} className="pl-9"
      />
      {loading && <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 animate-spin text-muted-foreground" />}
      {open && results.length > 0 && (
        <ul className="absolute z-20 mt-1 w-full rounded-lg border border-border bg-popover shadow-modal max-h-72 overflow-auto">
          {results.map((p) => (
            <li key={p.id}>
              <button type="button"
                onClick={() => { onPick(p); setQuery(""); setOpen(false); ref.current?.focus(); }}
                className="w-full text-left px-3 py-2 hover:bg-secondary/60 transition-colors">
                <div className="text-[13px] font-medium truncate">{p.itemName}</div>
                <div className="text-[11px] text-muted-foreground font-mono">{p.itemCode}</div>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Sélecteur de famille (liste chargée une fois, recherche locale). */
function FamilyPicker({ families, onPick }: { families: Family[]; onPick: (f: Family) => void }) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const q = query.trim().toLowerCase();
  const shown = q ? families.filter((f) => f.familyLabel.toLowerCase().includes(q)) : families;

  return (
    <div className="relative">
      <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
      <Input
        value={query}
        onFocus={() => setOpen(true)}
        onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        placeholder="Ajouter une famille (groseille, mûre, myrtille…)"
        className="pl-9"
      />
      {open && shown.length > 0 && (
        <ul className="absolute z-20 mt-1 w-full rounded-lg border border-border bg-popover shadow-modal max-h-72 overflow-auto">
          {shown.slice(0, 30).map((f) => (
            <li key={f.familyKey}>
              <button type="button"
                onClick={() => { onPick(f); setQuery(""); setOpen(false); }}
                className="w-full text-left px-3 py-2 hover:bg-secondary/60 transition-colors flex items-center justify-between gap-2">
                <span className="text-[13px] font-medium truncate">{f.familyLabel}</span>
                <span className="text-[10.5px] text-muted-foreground shrink-0">{f.productCount} réf.</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * Admin recettes d'ordre de production — composants par FAMILLE + lignes de coût.
 * Tout est exprimé EN COLIS. Le coût des lignes (main d'œuvre, emballage…) est
 * par colis de produit fini et sert au calcul de marge.
 */
export function RecipeAdmin() {
  const [parent, setParent] = useState<ProductHit | null>(null);
  const [components, setComponents] = useState<ComponentLine[]>([]);
  const [costs, setCosts] = useState<CostLine[]>([]);
  const [families, setFamilies] = useState<Family[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  // Liste des familles (une fois)
  useEffect(() => {
    fetch("/api/production/families").then((r) => r.json()).then((j) => setFamilies(j.families ?? [])).catch(() => {});
  }, []);

  const loadRecipe = useCallback(async (parentCode: string) => {
    setLoading(true);
    try {
      const r = await fetch(`/api/production/recipes?parentItemCode=${encodeURIComponent(parentCode)}`, { cache: "no-store" });
      const j = await r.json();
      setComponents((j.components ?? []).map((c: ComponentLine) => ({ ...c })));
      setCosts((j.costs ?? []).map((c: CostLine) => ({ ...c })));
    } catch { setComponents([]); setCosts([]); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => {
    if (parent) loadRecipe(parent.itemCode);
    else { setComponents([]); setCosts([]); }
  }, [parent, loadRecipe]);

  const addFamily = (f: Family) => {
    setComponents((cur) => {
      if (cur.some((l) => l.familyKey === f.familyKey)) {
        toast.info(`${f.familyLabel} déjà dans la recette`);
        return cur;
      }
      return [...cur, { familyKey: f.familyKey, familyLabel: f.familyLabel, qtyColis: 1 }];
    });
  };
  const updateCompQty = (i: number, qty: number) =>
    setComponents((c) => c.map((l, k) => k === i ? { ...l, qtyColis: qty } : l));
  const removeComp = (i: number) => setComponents((c) => c.filter((_, k) => k !== i));

  const addCost = () => setCosts((c) => [...c, { label: "", costPerColis: 0 }]);
  const updateCost = (i: number, patch: Partial<CostLine>) =>
    setCosts((c) => c.map((l, k) => k === i ? { ...l, ...patch } : l));
  const removeCost = (i: number) => setCosts((c) => c.filter((_, k) => k !== i));

  const totalCostPerColis = costs.reduce((s, c) => s + (c.costPerColis || 0), 0);

  const save = async () => {
    if (!parent) { toast.error("Choisis un produit fini"); return; }
    for (const l of components) {
      if (!l.qtyColis || l.qtyColis <= 0) { toast.error(`Quantité invalide sur ${l.familyLabel}`); return; }
    }
    for (const c of costs) {
      if (!c.label.trim()) { toast.error("Une ligne de coût n'a pas de libellé"); return; }
      if (c.costPerColis < 0) { toast.error(`Coût négatif sur "${c.label}"`); return; }
    }
    setSaving(true);
    try {
      const r = await fetch("/api/production/recipes", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          parentItemCode: parent.itemCode,
          components: components.map((l) => ({ familyKey: l.familyKey, familyLabel: l.familyLabel, qtyColis: l.qtyColis })),
          costs: costs.map((c) => ({ label: c.label.trim(), costPerColis: c.costPerColis || 0 })),
        }),
      });
      const j = await r.json();
      if (!r.ok || !j.ok) { toast.error(j.error || "Erreur"); return; }
      toast.success(`Recette ${parent.itemCode} enregistrée — ${j.componentCount} famille(s), ${j.costCount} coût(s)`);
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
        <h2 className="text-[15px] font-semibold">Recettes — ordre de production</h2>
      </div>
      <p className="text-[12px] text-muted-foreground">
        Une recette = des <b>familles</b> (groseille, mûre, myrtille…) en quantité de
        <b> colis par colis</b> de produit fini, plus des <b>lignes de coût</b> (main d&apos;œuvre,
        emballage, carton…) par colis qui servent au calcul de marge. À la production, le
        système consomme le stock réellement disponible de chaque famille en <b>FIFO</b>.
      </p>

      <div className="space-y-1.5">
        <label className="text-[11px] uppercase tracking-wide text-muted-foreground font-semibold">Produit fini fabriqué</label>
        <ProductPicker placeholder="ex. DECO, plateau, mélange…" onPick={setParent} />
      </div>

      {parent && (
        <div className="rounded-lg border border-border bg-card/50 px-3 py-2">
          <p className="text-[12px]">
            <span className="text-muted-foreground">Produit sélectionné : </span>
            <b>{parent.itemName}</b> <span className="font-mono text-[11px] text-muted-foreground">({parent.itemCode})</span>
            <button type="button" onClick={() => setParent(null)} className="ml-3 text-[11px] text-rose-500 hover:underline">Changer</button>
          </p>
        </div>
      )}

      {parent && !loading && (
        <>
          {/* ── Composants (familles, en colis) ── */}
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-[12px] font-semibold text-foreground">
              <Package className="h-3.5 w-3.5 text-muted-foreground" /> Composants — familles (colis par colis)
            </div>
            <FamilyPicker families={families} onPick={addFamily} />
            {components.length === 0 ? (
              <p className="text-[12px] italic text-muted-foreground py-2">Ajoute au moins une famille.</p>
            ) : (
              <div className="rounded-lg border border-border overflow-hidden">
                <table className="w-full text-[13px]">
                  <thead className="bg-secondary/40 text-[11px] uppercase tracking-wide text-muted-foreground">
                    <tr>
                      <th className="text-left px-3 py-2 font-semibold">Famille</th>
                      <th className="text-right px-3 py-2 font-semibold w-40">Colis / colis fini</th>
                      <th className="w-10" />
                    </tr>
                  </thead>
                  <tbody>
                    {components.map((l, i) => (
                      <tr key={l.familyKey} className="border-t border-border">
                        <td className="px-3 py-2 font-medium">{l.familyLabel}</td>
                        <td className="px-3 py-2">
                          <NumberInput
                            value={l.qtyColis}
                            onValueChange={(n) => updateCompQty(i, n ?? 0)}
                            min={0} step={1}
                            className="text-right h-9" />
                        </td>
                        <td className="px-2 py-2 text-right">
                          <Button variant="ghost" size="icon-sm" onClick={() => removeComp(i)} aria-label="Supprimer">
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* ── Lignes de coût (marge) ── */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-[12px] font-semibold text-foreground">
                <Euro className="h-3.5 w-3.5 text-muted-foreground" /> Coûts par colis (marge — hors stock)
              </div>
              <Button variant="ghost" size="sm" onClick={addCost}>
                <Plus className="h-3.5 w-3.5" /> Ajouter
              </Button>
            </div>
            {costs.length === 0 ? (
              <p className="text-[12px] italic text-muted-foreground py-2">
                Aucun coût. Ajoute main d&apos;œuvre, emballage, carton… (€ par colis).
              </p>
            ) : (
              <div className="rounded-lg border border-border overflow-hidden">
                <table className="w-full text-[13px]">
                  <thead className="bg-secondary/40 text-[11px] uppercase tracking-wide text-muted-foreground">
                    <tr>
                      <th className="text-left px-3 py-2 font-semibold">Poste</th>
                      <th className="text-right px-3 py-2 font-semibold w-40">€ / colis</th>
                      <th className="w-10" />
                    </tr>
                  </thead>
                  <tbody>
                    {costs.map((c, i) => (
                      <tr key={i} className="border-t border-border">
                        <td className="px-3 py-2">
                          <Input value={c.label} placeholder="ex. Main d'œuvre"
                            onChange={(e) => updateCost(i, { label: e.target.value })}
                            className="h-9" />
                        </td>
                        <td className="px-3 py-2">
                          <NumberInput
                            value={c.costPerColis}
                            onValueChange={(n) => updateCost(i, { costPerColis: n ?? 0 })}
                            decimals={2} min={0} step={0.1}
                            className="text-right h-9" />
                        </td>
                        <td className="px-2 py-2 text-right">
                          <Button variant="ghost" size="icon-sm" onClick={() => removeCost(i)} aria-label="Supprimer">
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </td>
                      </tr>
                    ))}
                    <tr className="border-t-2 border-border bg-secondary/30">
                      <td className="px-3 py-2 font-semibold uppercase text-[11px] tracking-wide text-muted-foreground">Total coûts / colis</td>
                      <td className="px-3 py-2 text-right font-bold tnum">{totalCostPerColis.toFixed(2)} €</td>
                      <td />
                    </tr>
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div className="flex justify-end gap-2 pt-2 border-t border-border">
            <Button onClick={save} disabled={saving}>
              {saving ? <Loader2 className="animate-spin" /> : <Save />}
              {saving ? "Enregistrement…" : "Enregistrer la recette"}
            </Button>
          </div>
        </>
      )}

      {parent && loading && (
        <p className="text-[12px] italic text-muted-foreground">Chargement de la recette…</p>
      )}
    </SurfaceCard>
  );
}
