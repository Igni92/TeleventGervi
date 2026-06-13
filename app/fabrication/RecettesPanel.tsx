"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Loader2, Plus, Trash2, Save, Search, BookOpen, Euro, Pencil, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { NumberInput } from "@/components/ui/number-input";
import { Button } from "@/components/ui/button";
import { SurfaceCard } from "@/components/ui/surface-card";
import { colis } from "./ui";

/**
 * Recettes de fabrication — par FAMILLE, avec ratio « tour » :
 *   « 2 colis DECO16 = 1 colis Myrtille + 1 colis Groseille + 2 colis Mûre »
 * L'article concret (GRO12H vs GRO12B…) se choisit au moment de FABRIQUER,
 * pas dans la recette.
 */

type ProductHit = { id: string; itemCode: string; itemName: string };
type Family = { familyKey: string; familyLabel: string; productCount: number };
type ComponentLine = { familyKey: string; familyLabel: string; qtyColis: number };
type CostLine = { label: string; costPerColis: number };
type RecipeListItem = {
  parentItemCode: string; itemName: string; parentQty: number;
  components: ComponentLine[]; costCount: number;
};

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
                onClick={() => { onPick(p); setQuery(""); setOpen(false); }}
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

export function RecettesPanel({ onRecipesChanged }: { onRecipesChanged: () => void }) {
  const [recipes, setRecipes] = useState<RecipeListItem[]>([]);
  const [families, setFamilies] = useState<Family[]>([]);
  const [showAllFamilies, setShowAllFamilies] = useState(false);

  // Éditeur
  const [parent, setParent] = useState<ProductHit | null>(null);
  const [parentQty, setParentQty] = useState(1);
  const [components, setComponents] = useState<ComponentLine[]>([]);
  const [costs, setCosts] = useState<CostLine[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  const loadList = useCallback(async () => {
    try {
      const r = await fetch("/api/fabrication/recipes?list=true", { cache: "no-store" });
      const j = await r.json();
      setRecipes(j.recipes ?? []);
    } catch { setRecipes([]); }
  }, []);

  useEffect(() => { loadList(); }, [loadList]);
  useEffect(() => {
    fetch("/api/production/families").then((r) => r.json()).then((j) => setFamilies(j.families ?? [])).catch(() => {});
  }, []);

  const openRecipe = useCallback(async (code: string, name: string) => {
    setParent({ id: code, itemCode: code, itemName: name });
    setLoading(true);
    try {
      const r = await fetch(`/api/fabrication/recipes?parentItemCode=${encodeURIComponent(code)}`, { cache: "no-store" });
      const j = await r.json();
      setParentQty(Number(j.parentQty) || 1);
      setComponents((j.components ?? []).map((c: ComponentLine) => ({ ...c })));
      setCosts((j.costs ?? []).map((c: CostLine) => ({ ...c })));
    } catch { setParentQty(1); setComponents([]); setCosts([]); }
    finally { setLoading(false); }
  }, []);

  const closeEditor = () => { setParent(null); setParentQty(1); setComponents([]); setCosts([]); };

  const addFamily = (f: Family) => {
    setComponents((cur) => {
      if (cur.some((l) => l.familyKey === f.familyKey)) {
        toast.info(`${f.familyLabel} déjà dans la recette`);
        return cur;
      }
      return [...cur, { familyKey: f.familyKey, familyLabel: f.familyLabel, qtyColis: 1 }];
    });
  };

  const save = async () => {
    if (!parent) { toast.error("Choisis un produit fini"); return; }
    if (!parentQty || parentQty <= 0) { toast.error("Colis produits par tour invalide"); return; }
    if (components.length === 0) { toast.error("Ajoute au moins une famille"); return; }
    for (const l of components) {
      if (!l.qtyColis || l.qtyColis <= 0) { toast.error(`Quantité invalide sur ${l.familyLabel}`); return; }
    }
    for (const c of costs) {
      if (!c.label.trim()) { toast.error("Une ligne de coût n'a pas de libellé"); return; }
    }
    setSaving(true);
    try {
      const r = await fetch("/api/fabrication/recipes", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          parentItemCode: parent.itemCode,
          parentQty,
          components: components.map((l) => ({ familyKey: l.familyKey, familyLabel: l.familyLabel, qtyColis: l.qtyColis })),
          costs: costs.map((c) => ({ label: c.label.trim(), costPerColis: c.costPerColis || 0 })),
        }),
      });
      const j = await r.json();
      if (!r.ok || !j.ok) { toast.error(j.error || "Erreur"); return; }
      toast.success(`Recette ${parent.itemCode} enregistrée`);
      closeEditor();
      await loadList();
      onRecipesChanged();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const remove = async (code: string) => {
    if (!confirm(`Supprimer la recette de ${code} ?`)) return;
    try {
      const r = await fetch(`/api/fabrication/recipes?parentItemCode=${encodeURIComponent(code)}`, { method: "DELETE" });
      const j = await r.json();
      if (!r.ok || !j.ok) { toast.error(j.error || "Erreur"); return; }
      toast.success(`Recette ${code} supprimée`);
      if (parent?.itemCode === code) closeEditor();
      await loadList();
      onRecipesChanged();
    } catch (e) { toast.error((e as Error).message); }
  };

  const fruitFamilies = families.filter((f) => !f.familyKey.startsWith("g_"));
  const otherFamilies = families.filter((f) => f.familyKey.startsWith("g_"));
  const shownFamilies = showAllFamilies ? [...fruitFamilies, ...otherFamilies] : fruitFamilies;

  // Phrase de lecture : « 2 colis DECO16 = 1 colis Myrtille + 2 colis Mûre »
  const sentence = parent && components.length > 0
    ? `${colis(parentQty)} colis ${parent.itemCode} = ${components.map((c) => `${colis(c.qtyColis)} colis ${c.familyLabel}`).join(" + ")}`
    : null;

  return (
    <SurfaceCard accent="violet" title="Recettes" icon={<BookOpen className="h-3.5 w-3.5" />} className="p-5">
      {/* ── Liste des recettes existantes ── */}
      {recipes.length > 0 && (
        <div className="space-y-1.5 mb-4">
          {recipes.map((r) => (
            <div key={r.parentItemCode}
              className={`flex items-center justify-between gap-3 rounded-lg border px-3 py-2 transition-colors ${
                parent?.itemCode === r.parentItemCode ? "border-violet-400/60 bg-violet-500/10" : "border-border bg-card/50"
              }`}>
              <div className="min-w-0">
                <p className="text-[14px] font-semibold truncate">
                  {r.itemName} <span className="font-mono text-[11px] text-muted-foreground">({r.parentItemCode})</span>
                </p>
                <p className="text-[12.5px] text-muted-foreground truncate">
                  {colis(r.parentQty)} colis = {r.components.map((c) => `${colis(c.qtyColis)} ${c.familyLabel}`).join(" + ") || "—"}
                </p>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <Button variant="ghost" size="icon-sm" aria-label={`Modifier ${r.parentItemCode}`}
                  onClick={() => openRecipe(r.parentItemCode, r.itemName)}>
                  <Pencil className="h-3.5 w-3.5" />
                </Button>
                <Button variant="ghost" size="icon-sm" aria-label={`Supprimer ${r.parentItemCode}`}
                  onClick={() => remove(r.parentItemCode)}>
                  <Trash2 className="h-3.5 w-3.5 text-rose-500" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── Nouveau / édition ── */}
      {!parent ? (
        <div className="space-y-1.5">
          <label className="text-[11px] uppercase tracking-wide text-muted-foreground font-semibold">
            Nouvelle recette — produit fini fabriqué
          </label>
          <ProductPicker placeholder="ex. DECO, plateau, mélange…" onPick={(p) => openRecipe(p.itemCode, p.itemName)} />
        </div>
      ) : loading ? (
        <p className="text-[13px] italic text-muted-foreground">Chargement de la recette…</p>
      ) : (
        <div className="space-y-5 rounded-lg border border-border bg-card/40 p-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-[15px] font-semibold">
                {parent.itemName} <span className="font-mono text-[12px] text-muted-foreground">({parent.itemCode})</span>
              </p>
              {sentence && (
                <p className="text-[13px] text-violet-600 dark:text-violet-300 font-medium mt-1">{sentence}</p>
              )}
            </div>
            <Button variant="ghost" size="icon-sm" onClick={closeEditor} aria-label="Fermer">
              <X className="h-4 w-4" />
            </Button>
          </div>

          {/* Ratio tour */}
          <div className="flex items-center gap-3">
            <label className="text-[12px] font-semibold text-foreground whitespace-nowrap">
              1 tour de recette produit
            </label>
            <NumberInput value={parentQty} onValueChange={(n) => setParentQty(n ?? 1)} min={1} step={1}
              className="w-24 text-right text-[15px] font-semibold" />
            <span className="text-[12px] text-muted-foreground">colis de {parent.itemCode}</span>
          </div>

          {/* Familles — chips cliquables */}
          <div className="space-y-2">
            <p className="text-[11px] uppercase tracking-wide text-muted-foreground font-semibold">
              Composants — clique une famille pour l&apos;ajouter
            </p>
            <div className="flex flex-wrap gap-1.5">
              {shownFamilies.map((f) => {
                const inRecipe = components.some((c) => c.familyKey === f.familyKey);
                return (
                  <button key={f.familyKey} type="button" onClick={() => addFamily(f)}
                    disabled={inRecipe}
                    className={`h-8 px-3 rounded-full border text-[13px] font-medium transition-colors ${
                      inRecipe
                        ? "border-violet-400/60 bg-violet-500/15 text-violet-600 dark:text-violet-300 cursor-default"
                        : "border-border bg-card hover:bg-secondary/60"
                    }`}>
                    {f.familyLabel}
                  </button>
                );
              })}
              {otherFamilies.length > 0 && (
                <button type="button" onClick={() => setShowAllFamilies((v) => !v)}
                  className="h-8 px-3 rounded-full border border-dashed border-border text-[12px] text-muted-foreground hover:bg-secondary/60 transition-colors">
                  {showAllFamilies ? "Réduire" : `Toutes les familles (${otherFamilies.length})`}
                </button>
              )}
            </div>

            {components.length === 0 ? (
              <p className="text-[12.5px] italic text-muted-foreground py-1">Ajoute au moins une famille.</p>
            ) : (
              <div className="rounded-lg border border-border overflow-hidden">
                <table className="w-full text-[13.5px]">
                  <thead className="bg-secondary/40 text-[11px] uppercase tracking-wide text-muted-foreground">
                    <tr>
                      <th className="text-left px-3 py-2 font-semibold">Famille</th>
                      <th className="text-right px-3 py-2 font-semibold w-44">Colis par tour</th>
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
                            onValueChange={(n) => setComponents((c) => c.map((x, k) => k === i ? { ...x, qtyColis: n ?? 0 } : x))}
                            min={0} step={1}
                            className="text-right h-9" />
                        </td>
                        <td className="px-2 py-2 text-right">
                          <Button variant="ghost" size="icon-sm" aria-label="Supprimer"
                            onClick={() => setComponents((c) => c.filter((_, k) => k !== i))}>
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

          {/* Lignes de coût (marge) */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-[12px] font-semibold text-foreground">
                <Euro className="h-3.5 w-3.5 text-muted-foreground" /> Coûts par colis fini (marge — hors stock)
              </div>
              <Button variant="ghost" size="sm" onClick={() => setCosts((c) => [...c, { label: "", costPerColis: 0 }])}>
                <Plus className="h-3.5 w-3.5" /> Ajouter
              </Button>
            </div>
            {costs.length === 0 ? (
              <p className="text-[12.5px] italic text-muted-foreground py-1">
                Aucun coût. Ajoute main d&apos;œuvre, emballage, carton… (€ par colis fini).
              </p>
            ) : (
              <div className="rounded-lg border border-border overflow-hidden">
                <table className="w-full text-[13.5px]">
                  <tbody>
                    {costs.map((c, i) => (
                      <tr key={i} className={i > 0 ? "border-t border-border" : ""}>
                        <td className="px-3 py-2">
                          <Input value={c.label} placeholder="ex. Main d'œuvre"
                            onChange={(e) => setCosts((cur) => cur.map((x, k) => k === i ? { ...x, label: e.target.value } : x))}
                            className="h-9" />
                        </td>
                        <td className="px-3 py-2 w-40">
                          <NumberInput
                            value={c.costPerColis}
                            onValueChange={(n) => setCosts((cur) => cur.map((x, k) => k === i ? { ...x, costPerColis: n ?? 0 } : x))}
                            decimals={2} min={0} step={0.1}
                            className="text-right h-9" />
                        </td>
                        <td className="px-2 py-2 w-10 text-right">
                          <Button variant="ghost" size="icon-sm" aria-label="Supprimer"
                            onClick={() => setCosts((cur) => cur.filter((_, k) => k !== i))}>
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

          <div className="flex justify-end gap-2 pt-2 border-t border-border">
            <Button variant="ghost" onClick={closeEditor}>Annuler</Button>
            <Button onClick={save} disabled={saving}>
              {saving ? <Loader2 className="animate-spin" /> : <Save />}
              {saving ? "Enregistrement…" : "Enregistrer la recette"}
            </Button>
          </div>
        </div>
      )}
    </SurfaceCard>
  );
}
