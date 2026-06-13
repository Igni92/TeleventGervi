"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Loader2, Factory, CheckCircle2, TriangleAlert, Scale } from "lucide-react";
import { NumberInput } from "@/components/ui/number-input";
import { Button } from "@/components/ui/button";
import { SurfaceCard } from "@/components/ui/surface-card";
import { scenariosTransformation, libelleUnite } from "@/lib/fabrication-optim";
import { ChipMarque, ChipCondi, ChipPays, LotBadge, WAREHOUSES, type WarehouseCode, eur, colis, qte, qtePhys } from "./ui";

/**
 * Fabriquer — run de production :
 *   1. choisir la recette + le nombre de colis (multiple du « tour »),
 *   2. pour CHAQUE famille, choisir l'article concret — par défaut seuls les
 *      articles avec stock réellement disponible sont proposés ; le toggle
 *      « + À découvert » (badge rose, même esprit que la Console) révèle les
 *      autres — le LOT est affecté automatiquement (FIFO, sinon EM_PENDING),
 *   3. optimiseur de TRANSFORMATION : dispo physique (unité de gestion réelle)
 *      ÷ conditionnement cible → scénarios triés par moindre écart
 *      (utilisé / restant / manquant / perte), la sélection pré-remplit le run,
 *   4. récap coût/marge puis validation → sorties + entrée SAP, lots tracés.
 */

type RecipeListItem = {
  parentItemCode: string; itemName: string; parentQty: number;
  components: { familyKey: string; familyLabel: string; qtyColis: number }[];
};
type Unite = { uniteColis: string; unitePhysique: string; physParColis: number; auPoids: boolean };
type ItemOption = {
  itemCode: string; itemName: string;
  uMarque: string | null; uCondi: string | null; uPays: string | null;
  ratio: number; unite: Unite; availColis: Record<string, number>; availTotal: number;
  decouvert: boolean;
  lot: { batchNumber: string; pending: boolean; priceColis: number | null; supplierName: string | null };
};
type FamilyOptions = { familyKey: string; familyLabel: string; qtyColisPerTour: number; items: ItemOption[] };
type Options = {
  parent: { itemCode: string; itemName: string; ratio: number; unite: Unite; lastSalePriceColis: number | null };
  recipe: { parentQty: number; costs: { label: string; costPerColis: number }[] };
  warehouse: string;
  families: FamilyOptions[];
};

const r3 = (n: number) => Math.round(n * 1000) / 1000;

export function FabriquerPanel({ recipesVersion, onRunDone }: { recipesVersion: number; onRunDone: () => void }) {
  const [recipes, setRecipes] = useState<RecipeListItem[]>([]);
  const [parentCode, setParentCode] = useState("");
  const [warehouse, setWarehouse] = useState<WarehouseCode>("01");
  const [parentColis, setParentColis] = useState(1);
  const [options, setOptions] = useState<Options | null>(null);
  const [loadingOptions, setLoadingOptions] = useState(false);
  const [picks, setPicks] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  // Par défaut : ne proposer que les lots réellement disponibles (stock > 0).
  // La case révèle les articles à découvert (fabrication anticipée, EM_PENDING).
  const [showDecouvert, setShowDecouvert] = useState(false);
  const [lastResult, setLastResult] = useState<{ opCode: string; exit: number; entry: number; cost: number } | null>(null);

  // Liste des recettes (rechargée quand l'admin recettes change quelque chose)
  useEffect(() => {
    fetch("/api/fabrication/recipes?list=true", { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => setRecipes(j.recipes ?? []))
      .catch(() => setRecipes([]));
  }, [recipesVersion]);

  const recipe = recipes.find((r) => r.parentItemCode === parentCode) ?? null;
  const parentQty = recipe?.parentQty ?? 1;

  // Quand on choisit une recette : quantité par défaut = 1 tour.
  useEffect(() => {
    if (recipe) setParentColis(recipe.parentQty);
  }, [recipe]);

  // Options (articles + lots par famille) — recharge si recette/entrepôt change.
  const loadOptions = useCallback(async () => {
    if (!parentCode) { setOptions(null); setPicks({}); return; }
    setLoadingOptions(true);
    try {
      const r = await fetch(
        `/api/fabrication/options?parent=${encodeURIComponent(parentCode)}&warehouse=${warehouse}`,
        { cache: "no-store" },
      );
      const j = await r.json();
      if (!r.ok || !j.ok) { toast.error(j.error || "Erreur chargement"); setOptions(null); return; }
      setOptions(j);
      // Pré-sélection : 1er article de chaque famille (trié dispo desc côté serveur).
      const def: Record<string, string> = {};
      for (const f of j.families as FamilyOptions[]) {
        if (f.items.length > 0) def[f.familyKey] = f.items[0].itemCode;
      }
      setPicks(def);
    } catch {
      setOptions(null);
      toast.error("Erreur chargement des articles");
    } finally {
      setLoadingOptions(false);
    }
  }, [parentCode, warehouse]);

  useEffect(() => { loadOptions(); }, [loadOptions]);

  const tours = parentQty > 0 ? parentColis / parentQty : 0;
  const isMultiple = Math.abs(tours - Math.round(tours)) < 1e-9 && tours > 0;

  // ── Récap : lignes choisies + coûts + marge ──
  const recap = useMemo(() => {
    if (!options || !isMultiple) return null;
    const lines = options.families.map((f) => {
      const item = f.items.find((i) => i.itemCode === picks[f.familyKey]) ?? null;
      const need = Math.round(f.qtyColisPerTour * tours * 1000) / 1000;
      const availHere = item ? (item.availColis[warehouse] ?? 0) : 0;
      return item ? {
        familyKey: f.familyKey, familyLabel: f.familyLabel, item, need,
        availHere,
        insufficient: !item.lot.pending && availHere < need,
        lineCost: item.lot.priceColis != null ? Math.round(item.lot.priceColis * need * 100) / 100 : null,
      } : null;
    });
    if (lines.some((l) => l === null)) return null;
    const ok = lines as NonNullable<(typeof lines)[number]>[];
    const componentsCost = ok.reduce((s, l) => s + (l.lineCost ?? 0), 0);
    const recipeCostPerColis = options.recipe.costs.reduce((s, c) => s + c.costPerColis, 0);
    const recipeCosts = Math.round(recipeCostPerColis * parentColis * 100) / 100;
    const totalCost = Math.round((componentsCost + recipeCosts) * 100) / 100;
    const parentValue = options.parent.lastSalePriceColis != null
      ? Math.round(options.parent.lastSalePriceColis * parentColis * 100) / 100 : null;
    return {
      lines: ok, componentsCost, recipeCosts, totalCost, parentValue,
      margin: parentValue != null ? Math.round((parentValue - totalCost) * 100) / 100 : null,
    };
  }, [options, picks, tours, parentColis, warehouse, isMultiple]);

  const submit = async () => {
    if (!recipe || !options || !recap) return;
    setSubmitting(true);
    setLastResult(null);
    try {
      const res = await fetch("/api/sap/assembly", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          parentItemCode: recipe.parentItemCode,
          parentColis,
          warehouseCode: warehouse,
          picks: Object.entries(picks).map(([familyKey, itemCode]) => ({ familyKey, itemCode })),
        }),
      });
      const j = await res.json();
      if (!res.ok || !j.ok) { toast.error(j.error || "Erreur SAP"); return; }
      toast.success(`${j.opCode} · Fabriqué ${parentColis} colis ${recipe.parentItemCode}`, {
        description: `Sortie #${j.sapExitDocNum} · Entrée #${j.sapEntryDocNum} · Coût ${j.totalCost.toFixed(2)} €`,
        duration: 10000,
      });
      setLastResult({ opCode: j.opCode, exit: j.sapExitDocNum, entry: j.sapEntryDocNum, cost: j.totalCost });
      setParentColis(recipe.parentQty);
      onRunDone();
      loadOptions(); // re-stock + lots à jour
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <SurfaceCard accent="brand" title="Fabriquer" icon={<Factory className="h-3.5 w-3.5" />} className="p-5">
      {lastResult && (
        <div className="flex items-center gap-2 rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-[13px] text-emerald-700 dark:text-emerald-300 mb-4">
          <CheckCircle2 className="h-4 w-4 shrink-0" />
          <span>{lastResult.opCode} · Sortie #{lastResult.exit} · Entrée #{lastResult.entry} · Coût {lastResult.cost.toFixed(2)} €</span>
        </div>
      )}

      {/* ── 1. Recette + quantité + entrepôt ── */}
      <div className="grid gap-4 sm:grid-cols-3">
        <div className="space-y-1.5">
          <label className="text-[11px] uppercase tracking-wide text-muted-foreground font-semibold">Produit à fabriquer</label>
          <select
            value={parentCode}
            onChange={(e) => setParentCode(e.target.value)}
            className="h-11 w-full rounded-md border border-input bg-background px-3 text-[14px]"
          >
            <option value="">— Choisir une recette —</option>
            {recipes.map((r) => (
              <option key={r.parentItemCode} value={r.parentItemCode}>
                {r.itemName} ({r.parentItemCode})
              </option>
            ))}
          </select>
          {recipe && (
            <p className="text-[12px] text-muted-foreground">
              1 tour = <b>{colis(recipe.parentQty)} colis</b> · {recipe.components.map((c) => `${colis(c.qtyColis)} ${c.familyLabel}`).join(" + ")}
            </p>
          )}
        </div>
        <div className="space-y-1.5">
          <label className="text-[11px] uppercase tracking-wide text-muted-foreground font-semibold">Quantité à produire (colis)</label>
          <NumberInput
            value={parentColis}
            onValueChange={(n) => setParentColis(n ?? 0)}
            min={parentQty} step={parentQty}
            className="h-11 text-[16px] font-semibold text-right"
          />
          {recipe && !isMultiple && (
            <p className="text-[12px] text-rose-500 font-medium">
              Doit être un multiple de {colis(parentQty)} colis.
            </p>
          )}
          {recipe && isMultiple && tours > 0 && (
            <p className="text-[12px] text-muted-foreground">= {colis(tours)} tour{tours > 1 ? "s" : ""} de recette</p>
          )}
        </div>
        <div className="space-y-1.5">
          <label className="text-[11px] uppercase tracking-wide text-muted-foreground font-semibold">Entrepôt</label>
          <select
            value={warehouse}
            onChange={(e) => setWarehouse(e.target.value as WarehouseCode)}
            className="h-11 w-full rounded-md border border-input bg-background px-3 text-[14px]"
          >
            {WAREHOUSES.map((w) => <option key={w.code} value={w.code}>{w.label}</option>)}
          </select>
        </div>
      </div>

      {/* ── 2. Choix de l'article par famille ── */}
      {parentCode && loadingOptions && (
        <p className="text-[13px] italic text-muted-foreground mt-4 flex items-center gap-2">
          <Loader2 className="h-4 w-4 animate-spin" /> Chargement des articles et des lots…
        </p>
      )}
      {options && !loadingOptions && (
        <div className="mt-5 space-y-4">
          <label className="flex items-center gap-2 text-[12px] text-muted-foreground cursor-pointer select-none">
            <input
              type="checkbox"
              checked={showDecouvert}
              onChange={(e) => setShowDecouvert(e.target.checked)}
              className="h-3.5 w-3.5 rounded-[3px] accent-rose-500 cursor-pointer"
            />
            Afficher aussi les articles à découvert (stock ≤ 0)
          </label>
          {options.families.map((f) => {
            const need = isMultiple ? Math.round(f.qtyColisPerTour * tours * 1000) / 1000 : null;
            // Par défaut : uniquement les lots réellement disponibles (stock > 0).
            const visibleItems = showDecouvert ? f.items : f.items.filter((it) => !it.decouvert);
            const hiddenCount = f.items.length - visibleItems.length;
            return (
              <div key={f.familyKey} className="rounded-lg border border-border overflow-hidden">
                <div className="px-3 py-2 bg-secondary/40 flex items-center justify-between">
                  <p className="text-[12px] uppercase tracking-wide font-semibold text-foreground">
                    {f.familyLabel}
                    {need != null && (
                      <span className="ml-2 normal-case tracking-normal font-bold text-[13px] text-brand-600 dark:text-brand-300">
                        {colis(need)} colis
                      </span>
                    )}
                  </p>
                  <p className="text-[11px] text-muted-foreground">
                    {visibleItems.length} article(s){hiddenCount > 0 ? ` · ${hiddenCount} à découvert` : ""}
                  </p>
                </div>
                {visibleItems.length === 0 ? (
                  <p className="text-[13px] italic text-rose-500 px-3 py-3">
                    {f.items.length === 0
                      ? "Aucun article dans cette famille — impossible de fabriquer."
                      : "Aucun article en stock — coche « à découvert » pour les proposer."}
                  </p>
                ) : (
                  <ul className="divide-y divide-border">
                    {visibleItems.map((it) => {
                      const selected = picks[f.familyKey] === it.itemCode;
                      const availHere = it.availColis[warehouse] ?? 0;
                      return (
                        <li key={it.itemCode}>
                          <button type="button"
                            onClick={() => setPicks((p) => ({ ...p, [f.familyKey]: it.itemCode }))}
                            className={`w-full text-left px-3 py-2.5 flex items-center gap-3 transition-colors ${
                              selected ? "bg-brand-500/10 ring-1 ring-inset ring-brand-500/50" : "hover:bg-secondary/40"
                            }`}>
                            <span aria-hidden
                              className={`h-4 w-4 shrink-0 rounded-full border-2 ${
                                selected ? "border-brand-500 bg-brand-500" : "border-muted-foreground/40"
                              }`} />
                            <span className="min-w-0 flex-1">
                              <span className="flex items-center gap-1.5 flex-wrap">
                                <span className="text-[14px] font-semibold truncate">{it.itemName}</span>
                                <span className="font-mono text-[11px] text-muted-foreground">{it.itemCode}</span>
                                {it.uMarque && <ChipMarque value={it.uMarque} />}
                                {it.uCondi && <ChipCondi value={it.uCondi} />}
                                {it.uPays && <ChipPays value={it.uPays} />}
                              </span>
                              <span className="mt-1 flex items-center gap-2 flex-wrap text-[12px]">
                                <LotBadge batchNumber={it.lot.batchNumber} pending={it.lot.pending} />
                                {it.lot.priceColis != null && (
                                  <span className="text-muted-foreground">
                                    achat <b className="text-foreground">{eur(it.lot.priceColis)}</b>/colis
                                    {it.lot.supplierName ? ` · ${it.lot.supplierName}` : ""}
                                  </span>
                                )}
                              </span>
                            </span>
                            <span className="shrink-0 text-right">
                              <span className={`block text-[16px] font-bold tnum ${
                                availHere > 0 ? "text-emerald-600 dark:text-emerald-400" : "text-rose-500"
                              }`}>
                                {colis(availHere)}
                              </span>
                              <span className="block text-[10.5px] text-muted-foreground">
                                colis dispo · {warehouse}
                              </span>
                            </span>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            );
          })}

          {/* ── 3. Récap avant validation ── */}
          {recap && (
            <div className="rounded-lg border border-border overflow-hidden">
              <div className="px-3 py-2 bg-secondary/40">
                <p className="text-[12px] uppercase tracking-wide font-semibold text-foreground">
                  Récapitulatif — {colis(parentColis)} colis {options.parent.itemCode}
                </p>
              </div>
              <table className="w-full text-[13.5px]">
                <thead className="text-[11px] uppercase tracking-wide text-muted-foreground">
                  <tr className="border-t border-border">
                    <th className="text-left px-3 py-2 font-semibold">Famille → article</th>
                    <th className="text-left px-3 py-2 font-semibold">Lot</th>
                    <th className="text-right px-3 py-2 font-semibold w-20">Colis</th>
                    <th className="text-right px-3 py-2 font-semibold w-28">€/colis</th>
                    <th className="text-right px-3 py-2 font-semibold w-28">Coût</th>
                  </tr>
                </thead>
                <tbody>
                  {recap.lines.map((l) => (
                    <tr key={l.familyKey} className="border-t border-border">
                      <td className="px-3 py-2">
                        <span className="font-medium">{l.familyLabel}</span>
                        <span className="text-muted-foreground"> → </span>
                        <span className="font-mono text-[12px]">{l.item.itemCode}</span>
                        {l.insufficient && (
                          <span className="ml-2 inline-flex items-center gap-1 text-[11px] text-amber-600 dark:text-amber-400 font-medium">
                            <TriangleAlert className="h-3 w-3" /> {colis(l.availHere)} dispo seulement
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2">
                        <LotBadge batchNumber={l.item.lot.batchNumber} pending={l.item.lot.pending} />
                      </td>
                      <td className="px-3 py-2 text-right tnum font-semibold">{colis(l.need)}</td>
                      <td className="px-3 py-2 text-right tnum text-muted-foreground">
                        {l.item.lot.priceColis != null ? eur(l.item.lot.priceColis) : "—"}
                      </td>
                      <td className="px-3 py-2 text-right tnum font-semibold">
                        {l.lineCost != null ? eur(l.lineCost) : "—"}
                      </td>
                    </tr>
                  ))}
                  {options.recipe.costs.map((c) => (
                    <tr key={c.label} className="border-t border-border text-muted-foreground">
                      <td className="px-3 py-2" colSpan={3}>{c.label} <span className="text-[11px]">({eur(c.costPerColis)}/colis fini)</span></td>
                      <td className="px-3 py-2 text-right tnum">{eur(c.costPerColis)}</td>
                      <td className="px-3 py-2 text-right tnum">{eur(Math.round(c.costPerColis * parentColis * 100) / 100)}</td>
                    </tr>
                  ))}
                  <tr className="border-t-2 border-border bg-secondary/30">
                    <td colSpan={4} className="px-3 py-2 text-right font-semibold">Coût total</td>
                    <td className="px-3 py-2 text-right tnum font-bold text-[15px]">{eur(recap.totalCost)}</td>
                  </tr>
                  {recap.parentValue != null && (
                    <>
                      <tr className="border-t border-border">
                        <td colSpan={4} className="px-3 py-2 text-right text-muted-foreground">
                          Valeur estimée ({eur(options.parent.lastSalePriceColis!)}/colis, dernier prix vendu)
                        </td>
                        <td className="px-3 py-2 text-right tnum">{eur(recap.parentValue)}</td>
                      </tr>
                      <tr className="border-t border-border">
                        <td colSpan={4} className="px-3 py-2 text-right font-semibold">Marge estimée</td>
                        <td className={`px-3 py-2 text-right tnum font-bold text-[15px] ${
                          (recap.margin ?? 0) >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-rose-500"
                        }`}>
                          {eur(recap.margin!)}
                        </td>
                      </tr>
                    </>
                  )}
                </tbody>
              </table>
            </div>
          )}

          <div className="flex items-center justify-end gap-2 pt-1">
            <Button onClick={submit} size="lg"
              disabled={submitting || !recap || !isMultiple || recap.lines.length === 0}>
              {submitting ? <Loader2 className="animate-spin" /> : <Factory />}
              {submitting ? "Fabrication…" : "Lancer la fabrication"}
            </Button>
          </div>
        </div>
      )}
    </SurfaceCard>
  );
}
