"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Loader2, Factory, CheckCircle2, TriangleAlert, ArrowRight } from "lucide-react";
import { NumberInput } from "@/components/ui/number-input";
import { Button } from "@/components/ui/button";
import { SurfaceCard } from "@/components/ui/surface-card";
import { libelleUnite, quantitesComposant, uniteBase, type ModeQuantite } from "@/lib/fabrication-optim";
import { ChipMarque, ChipCondi, ChipPays, LotBadge, WAREHOUSES, type WarehouseCode, eur, colis, qtePhys } from "./ui";

/**
 * Fabriquer — run de production v3 :
 *   1. choisir la recette + le nombre de colis (multiple du « tour ») et le
 *      MAGASIN D'ENTRÉE du produit fini,
 *   2. pour CHAQUE famille, choisir l'article concret ET son MAGASIN SOURCE —
 *      les composants peuvent sortir de magasins différents (000/01/R1) et le
 *      produit fini entrer dans un autre. Par défaut seuls les articles avec
 *      stock dans le magasin source sont proposés ; le toggle « à découvert »
 *      révèle les autres — le LOT est affecté automatiquement (FIFO, sinon
 *      EM_PENDING),
 *   3. les besoins s'affichent en UNITÉS DE BASE (6 barquettes groseille…)
 *      avec l'équivalent colis de l'article choisi (0,5 colis de 12 — les
 *      colis peuvent être entamés),
 *   4. récap coût/marge puis validation → sorties + entrée SAP, lots tracés.
 */

type RecipeComponent = { familyKey: string; familyLabel: string; qty: number; mode: ModeQuantite };
type RecipeListItem = {
  parentItemCode: string; itemName: string; parentQty: number;
  components: RecipeComponent[];
};
type Unite = { uniteColis: string; unitePhysique: string; physParColis: number; auPoids: boolean };
type LotView = {
  batchNumber: string; pending: boolean; priceColis?: number | null;
  source: string | null; supplierName: string | null;
};
type ItemOption = {
  itemCode: string; itemName: string;
  uMarque: string | null; uCondi: string | null; uPays: string | null;
  ratio: number; unite: Unite; uniteBase: string;
  availColis: Record<string, number>; availUnits: Record<string, number>; availTotal: number;
  /** lot proposé PAR MAGASIN (000/01/R1) */
  lots: Record<string, LotView>;
};
type FamilyOptions = {
  familyKey: string; familyLabel: string;
  qtyPerTour: number; mode: ModeQuantite;
  items: ItemOption[];
};
type Options = {
  parent: { itemCode: string; itemName: string; ratio: number; unite: Unite; lastSalePriceColis: number | null };
  recipe: { parentQty: number; costs: { label: string; costPerColis: number }[] };
  families: FamilyOptions[];
};
type Pick_ = { itemCode: string; whs: WarehouseCode };

/** Magasin source par défaut d'un article : le plus fourni (01 préféré à égalité). */
function bestWarehouse(it: ItemOption): WarehouseCode {
  const order: WarehouseCode[] = ["01", "000", "R1"];
  let best: WarehouseCode = "01";
  let bestV = -Infinity;
  for (const w of order) {
    const v = it.availUnits[w] ?? 0;
    if (v > bestV + 1e-9) { best = w; bestV = v; }
  }
  return bestV > 0 ? best : "01";
}

/** Mot d'unité d'une ligne de recette côté « Fabriquer ». */
function uniteFamille(f: { familyKey: string; mode: ModeQuantite }, picked: ItemOption | null, n: number): string {
  if (f.mode === "colis") return "colis";
  return libelleUnite(picked?.uniteBase ?? uniteBase({ familyKey: f.familyKey }), n);
}

export function FabriquerPanel({ recipesVersion, onRunDone }: { recipesVersion: number; onRunDone: () => void }) {
  const [recipes, setRecipes] = useState<RecipeListItem[]>([]);
  const [parentCode, setParentCode] = useState("");
  // Magasin d'ENTRÉE du produit fini — indépendant des magasins SOURCE des composants.
  const [entryWhs, setEntryWhs] = useState<WarehouseCode>("01");
  const [parentColis, setParentColis] = useState(1);
  const [options, setOptions] = useState<Options | null>(null);
  const [loadingOptions, setLoadingOptions] = useState(false);
  // Par famille : article choisi + magasin source de la sortie.
  const [picks, setPicks] = useState<Record<string, Pick_>>({});
  const [submitting, setSubmitting] = useState(false);
  // Par défaut : ne proposer que les articles avec stock dans le magasin source.
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

  // Options (articles + lots des 3 magasins par famille) — recharge si la recette change.
  const loadOptions = useCallback(async () => {
    if (!parentCode) { setOptions(null); setPicks({}); return; }
    setLoadingOptions(true);
    try {
      const r = await fetch(
        `/api/fabrication/options?parent=${encodeURIComponent(parentCode)}`,
        { cache: "no-store" },
      );
      const j = await r.json();
      if (!r.ok || !j.ok) { toast.error(j.error || "Erreur chargement"); setOptions(null); return; }
      setOptions(j);
      // Pré-sélection : 1er article de chaque famille (trié dispo desc côté
      // serveur) + son magasin le plus fourni comme source.
      const def: Record<string, Pick_> = {};
      for (const f of j.families as FamilyOptions[]) {
        if (f.items.length > 0) def[f.familyKey] = { itemCode: f.items[0].itemCode, whs: bestWarehouse(f.items[0]) };
      }
      setPicks(def);
    } catch {
      setOptions(null);
      toast.error("Erreur chargement des articles");
    } finally {
      setLoadingOptions(false);
    }
  }, [parentCode]);

  useEffect(() => { loadOptions(); }, [loadOptions]);

  const tours = parentQty > 0 ? parentColis / parentQty : 0;
  const isMultiple = Math.abs(tours - Math.round(tours)) < 1e-9 && tours > 0;

  // ── Récap : lignes choisies (article + magasin source) + coûts + marge ──
  const recap = useMemo(() => {
    if (!options || !isMultiple) return null;
    const lines = options.families.map((f) => {
      const pick = picks[f.familyKey];
      const item = pick ? f.items.find((i) => i.itemCode === pick.itemCode) ?? null : null;
      if (!item || !pick) return null;
      // v3 : besoin en unités de base → colis fractionnaires possibles.
      const { pieceQty, colisQty } = quantitesComposant(f.qtyPerTour, f.mode, tours, item.ratio);
      const lot = item.lots[pick.whs];
      const availUnitsHere = item.availUnits[pick.whs] ?? 0;
      return {
        familyKey: f.familyKey, familyLabel: f.familyLabel, mode: f.mode,
        item, whs: pick.whs, lot, pieceQty, colisQty,
        availColisHere: item.availColis[pick.whs] ?? 0,
        insufficient: !lot.pending && availUnitsHere < pieceQty,
        lineCost: lot.priceColis != null ? Math.round(lot.priceColis * colisQty * 100) / 100 : null,
      };
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
  }, [options, picks, tours, parentColis, isMultiple]);

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
          warehouseCode: entryWhs, // magasin d'ENTRÉE du produit fini
          picks: Object.entries(picks).map(([familyKey, p]) => ({
            familyKey, itemCode: p.itemCode, warehouseCode: p.whs, // magasin SOURCE
          })),
        }),
      });
      const j = await res.json();
      if (!res.ok || !j.ok) { toast.error(j.error || "Erreur SAP"); return; }
      toast.success(`${j.opCode} · Fabriqué ${parentColis} colis ${recipe.parentItemCode}`, {
        description: `Sortie #${j.sapExitDocNum} · Entrée #${j.sapEntryDocNum} → ${entryWhs} · Coût ${j.totalCost.toFixed(2)} €`,
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

      {/* ── 1. Recette + quantité + magasin d'entrée du produit fini ── */}
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
              1 tour = <b>{colis(recipe.parentQty)} colis</b> ·{" "}
              {recipe.components.map((c) =>
                `${colis(c.qty)} ${c.mode === "colis" ? "colis" : libelleUnite(uniteBase({ familyKey: c.familyKey }), c.qty)} ${c.familyLabel}`,
              ).join(" + ")}
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
          <label className="text-[11px] uppercase tracking-wide text-muted-foreground font-semibold">Magasin d&apos;entrée (produit fini)</label>
          <select
            value={entryWhs}
            onChange={(e) => setEntryWhs(e.target.value as WarehouseCode)}
            className="h-11 w-full rounded-md border border-input bg-background px-3 text-[14px]"
          >
            {WAREHOUSES.map((w) => <option key={w.code} value={w.code}>{w.label}</option>)}
          </select>
          <p className="text-[12px] text-muted-foreground">
            Chaque composant sort de son propre magasin, choisi famille par famille.
          </p>
        </div>
      </div>

      {/* ── 2. Choix de l'article + magasin source par famille ── */}
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
            Afficher aussi les articles à découvert (stock ≤ 0 dans le magasin source)
          </label>
          {options.families.map((f) => {
            const pick = picks[f.familyKey];
            const famWhs: WarehouseCode = pick?.whs ?? "01";
            const picked = pick ? f.items.find((i) => i.itemCode === pick.itemCode) ?? null : null;
            // Besoin de la famille pour ce run — en unités de base (v3) ou colis (legacy).
            const needQty = isMultiple ? Math.round(f.qtyPerTour * tours * 1000) / 1000 : null;
            const needColis = needQty != null && picked
              ? quantitesComposant(f.qtyPerTour, f.mode, tours, picked.ratio).colisQty
              : null;
            // Visibles : stock > 0 dans le magasin source (l'article déjà choisi reste visible).
            const visibleItems = showDecouvert
              ? f.items
              : f.items.filter((it) => (it.availUnits[famWhs] ?? 0) > 0 || it.itemCode === pick?.itemCode);
            const hiddenCount = f.items.length - visibleItems.length;
            return (
              <div key={f.familyKey} className="rounded-lg border border-border overflow-hidden">
                <div className="px-3 py-2 bg-secondary/40 flex items-center justify-between gap-3 flex-wrap">
                  <p className="text-[12px] uppercase tracking-wide font-semibold text-foreground">
                    {f.familyLabel}
                    {needQty != null && (
                      <span className="ml-2 normal-case tracking-normal font-bold text-[13px] text-brand-600 dark:text-brand-300">
                        {qtePhys(needQty)} {uniteFamille(f, picked, needQty)}
                      </span>
                    )}
                    {needColis != null && f.mode === "unite" && (
                      <span className="ml-1.5 normal-case tracking-normal text-[12px] text-muted-foreground">
                        = {colis(needColis)} colis
                      </span>
                    )}
                  </p>
                  <div className="flex items-center gap-2">
                    <label className="text-[11px] text-muted-foreground whitespace-nowrap">Sortie du magasin</label>
                    <select
                      value={famWhs}
                      onChange={(e) => {
                        const whs = e.target.value as WarehouseCode;
                        setPicks((p) => pick ? { ...p, [f.familyKey]: { ...pick, whs } } : p);
                      }}
                      aria-label={`Magasin source pour ${f.familyLabel}`}
                      className="h-8 rounded-md border border-input bg-background px-2 text-[12.5px]"
                    >
                      {WAREHOUSES.map((w) => <option key={w.code} value={w.code}>{w.label}</option>)}
                    </select>
                    <span className="text-[11px] text-muted-foreground whitespace-nowrap">
                      {visibleItems.length} article(s){hiddenCount > 0 ? ` · ${hiddenCount} à découvert` : ""}
                    </span>
                  </div>
                </div>
                {visibleItems.length === 0 ? (
                  <p className="text-[13px] italic text-rose-500 px-3 py-3">
                    {f.items.length === 0
                      ? "Aucun article dans cette famille — impossible de fabriquer."
                      : "Aucun article en stock dans ce magasin — change de magasin ou coche « à découvert »."}
                  </p>
                ) : (
                  <ul className="divide-y divide-border">
                    {visibleItems.map((it) => {
                      const selected = pick?.itemCode === it.itemCode;
                      const availHere = it.availColis[famWhs] ?? 0;
                      const lot = it.lots[famWhs];
                      return (
                        <li key={it.itemCode}>
                          <button type="button"
                            onClick={() => setPicks((p) => ({ ...p, [f.familyKey]: { itemCode: it.itemCode, whs: famWhs } }))}
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
                                <LotBadge batchNumber={lot.batchNumber} pending={lot.pending} />
                                {lot.priceColis != null && (
                                  <span className="text-muted-foreground">
                                    achat <b className="text-foreground">{eur(lot.priceColis)}</b>/colis
                                    {lot.supplierName ? ` · ${lot.supplierName}` : ""}
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
                                colis dispo · {famWhs}
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
            <div className="rounded-lg border border-border overflow-x-auto">
              <div className="px-3 py-2 bg-secondary/40">
                <p className="text-[12px] uppercase tracking-wide font-semibold text-foreground">
                  Récapitulatif — {colis(parentColis)} colis {options.parent.itemCode}
                  <span className="ml-1.5 normal-case tracking-normal text-muted-foreground font-medium">
                    (entrée magasin {entryWhs})
                  </span>
                </p>
              </div>
              <table className="w-full text-[13.5px]">
                <thead className="text-[11px] uppercase tracking-wide text-muted-foreground">
                  <tr className="border-t border-border">
                    <th className="text-left px-3 py-2 font-semibold">Famille → article</th>
                    <th className="text-left px-3 py-2 font-semibold w-20">Magasin</th>
                    <th className="text-left px-3 py-2 font-semibold">Lot</th>
                    <th className="text-right px-3 py-2 font-semibold w-32">Quantité</th>
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
                            <TriangleAlert className="h-3 w-3" /> {colis(l.availColisHere)} colis dispo seulement
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2">
                        <span className="inline-flex items-center gap-1 font-mono text-[12px]">
                          {l.whs} <ArrowRight className="h-3 w-3 text-muted-foreground" /> {entryWhs}
                        </span>
                      </td>
                      <td className="px-3 py-2">
                        <LotBadge batchNumber={l.lot.batchNumber} pending={l.lot.pending} />
                      </td>
                      <td className="px-3 py-2 text-right tnum font-semibold whitespace-nowrap">
                        {l.mode === "unite" ? (
                          <>
                            {qtePhys(l.pieceQty)} {uniteFamille(l, l.item, l.pieceQty)}
                            <span className="block text-[11px] font-normal text-muted-foreground">= {colis(l.colisQty)} colis</span>
                          </>
                        ) : (
                          <>{colis(l.colisQty)} colis</>
                        )}
                      </td>
                      <td className="px-3 py-2 text-right tnum text-muted-foreground">
                        {l.lot.priceColis != null ? eur(l.lot.priceColis) : "—"}
                      </td>
                      <td className="px-3 py-2 text-right tnum font-semibold">
                        {l.lineCost != null ? eur(l.lineCost) : "—"}
                      </td>
                    </tr>
                  ))}
                  {options.recipe.costs.map((c) => (
                    <tr key={c.label} className="border-t border-border text-muted-foreground">
                      <td className="px-3 py-2" colSpan={4}>{c.label} <span className="text-[11px]">({eur(c.costPerColis)}/colis fini)</span></td>
                      <td className="px-3 py-2 text-right tnum">{eur(c.costPerColis)}</td>
                      <td className="px-3 py-2 text-right tnum">{eur(Math.round(c.costPerColis * parentColis * 100) / 100)}</td>
                    </tr>
                  ))}
                  <tr className="border-t-2 border-border bg-secondary/30">
                    <td colSpan={5} className="px-3 py-2 text-right font-semibold">Coût total</td>
                    <td className="px-3 py-2 text-right tnum font-bold text-[15px]">{eur(recap.totalCost)}</td>
                  </tr>
                  {recap.parentValue != null && (
                    <>
                      <tr className="border-t border-border">
                        <td colSpan={5} className="px-3 py-2 text-right text-muted-foreground">
                          Valeur estimée ({eur(options.parent.lastSalePriceColis!)}/colis, dernier prix vendu)
                        </td>
                        <td className="px-3 py-2 text-right tnum">{eur(recap.parentValue)}</td>
                      </tr>
                      <tr className="border-t border-border">
                        <td colSpan={5} className="px-3 py-2 text-right font-semibold">Marge estimée</td>
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
