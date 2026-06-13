"use client";

import { useEffect, useState, useCallback } from "react";
import { Loader2, RefreshCw, ChevronDown, ChevronRight, Search } from "lucide-react";
import { personalStock, unitInfo } from "@/lib/gervifrais-calc";

interface StockEntry { available: number }
interface Product {
  id: string; itemCode: string; itemName: string; groupName: string | null;
  salesUnit: string | null; salesQtyPerPackUnit: number | null;
  uMarque: string | null; uPays: string | null; uCondi: string | null; uUvc: string | null;
  stockByWarehouse: Record<string, StockEntry>;
}

/**
 * Stock TOUJOURS affiché (écran 2) : tous les produits en stock, groupés par famille,
 * avec le stock perso (× %) en kg/pie. Filtre rapide optionnel, pas de recherche obligatoire.
 */
export function StockPanel({ sharePct = 100 }: { sharePct?: number }) {
  const [grouped, setGrouped] = useState<Record<string, Product[]>>({});
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [filter, setFilter] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/products?inStock=true&limit=400");
      const json = await res.json();
      const byGroup: Record<string, Product[]> = {};
      for (const p of (json.products ?? []) as Product[]) {
        const g = p.groupName?.trim() || "Autres";
        (byGroup[g] ||= []).push(p);
      }
      Object.values(byGroup).forEach((a) => a.sort((x, y) => x.itemName.localeCompare(y.itemName)));
      setGrouped(byGroup);
      // Tout déplié par défaut (stock visible en permanence)
      setOpen(Object.fromEntries(Object.keys(byGroup).map((g) => [g, true])));
    } catch { setGrouped({}); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);
  // Sync delta SAP toutes les 30 s puis refetch — la route est throttled côté
  // serveur (≤ 1 pull SAP / 20 s peu importe le nombre de clients).
  useEffect(() => {
    const tick = async () => {
      try { await fetch("/api/sap/sync/delta", { method: "POST" }); } catch { /* silent */ }
      load();
    };
    const t = setInterval(tick, 30 * 1000);
    return () => clearInterval(t);
  }, [load]);

  const dispoOf = (p: Product) => {
    const { packDivisor } = unitInfo(p.salesUnit, p.salesQtyPerPackUnit);
    return ["R1", "01", "000"].reduce((s, w) => s + (p.stockByWarehouse[w]?.available ?? 0), 0) / packDivisor;
  };
  const q = filter.trim().toLowerCase();

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="flex items-center gap-2 mb-2 shrink-0">
        <div className="relative flex-1">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filtrer (optionnel)…"
            className="w-full h-8 pl-8 pr-2 rounded-md border border-border bg-background text-[12.5px] focus:outline-none focus:ring-1 focus:ring-brand-500"
          />
        </div>
        <button type="button" onClick={load} disabled={loading}
          className="inline-flex items-center gap-1 h-8 px-2 rounded-md border border-border text-[11.5px] text-muted-foreground hover:text-foreground">
          {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
        </button>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto space-y-2 pr-1">
        {loading && Object.keys(grouped).length === 0 && (
          <p className="text-[12px] text-muted-foreground inline-flex items-center gap-2 py-3"><Loader2 className="h-4 w-4 animate-spin" /> Chargement du stock…</p>
        )}
        {Object.entries(grouped).sort(([a], [b]) => a.localeCompare(b)).map(([group, prods]) => {
          const visible = q ? prods.filter((p) => (p.itemName + p.itemCode).toLowerCase().includes(q)) : prods;
          if (visible.length === 0) return null;
          const isOpen = q ? true : (open[group] ?? true);
          return (
            <div key={group} className="border border-border rounded-lg overflow-hidden">
              <button type="button" onClick={() => setOpen((o) => ({ ...o, [group]: !isOpen }))}
                className="w-full px-3 py-1.5 flex items-center justify-between bg-secondary/40 hover:bg-secondary/60 transition-colors">
                <span className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-foreground">
                  {isOpen ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                  {group} <span className="text-[10.5px] font-normal text-muted-foreground">({visible.length})</span>
                </span>
              </button>
              {isOpen && (
                <ul className="divide-y divide-border/40">
                  {visible.map((p) => {
                    const unit = unitInfo(p.salesUnit, p.salesQtyPerPackUnit).displayUnit;
                    const total = dispoOf(p);
                    const perso = personalStock(total, sharePct);
                    const low = (sharePct < 100 ? perso : total) <= 5;
                    return (
                      <li key={p.id} className="px-3 py-1.5 flex items-center justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-[12.5px] font-medium text-foreground truncate">{p.itemName}</p>
                          {(p.uMarque || p.uCondi || p.uUvc || p.uPays) && (
                            <span className="mt-0.5 flex items-center gap-1 flex-wrap">
                              {p.uMarque && (
                                <span className="inline-flex h-3.5 items-center px-1 rounded text-[9.5px] font-semibold bg-violet-100 text-violet-800 dark:bg-violet-500/30 dark:text-violet-100 dark:ring-1 dark:ring-inset dark:ring-violet-400/50">
                                  {p.uMarque}
                                </span>
                              )}
                              {(p.uCondi || p.uUvc) && (
                                <span className="inline-flex h-3.5 items-center px-1 rounded text-[9.5px] font-semibold bg-sky-100 text-sky-800 dark:bg-sky-500/30 dark:text-sky-100 dark:ring-1 dark:ring-inset dark:ring-sky-400/50">
                                  {p.uCondi ?? p.uUvc}
                                </span>
                              )}
                              {p.uPays && (
                                <span className="inline-flex h-3.5 items-center px-1 rounded text-[9.5px] font-semibold bg-amber-100 text-amber-800 dark:bg-amber-500/30 dark:text-amber-100 dark:ring-1 dark:ring-inset dark:ring-amber-400/50">
                                  {p.uPays}
                                </span>
                              )}
                            </span>
                          )}
                          <p className="text-[10px] font-mono text-muted-foreground/70 truncate mt-0.5">{p.itemCode}</p>
                        </div>
                        <div className="text-right shrink-0 tnum">
                          {sharePct < 100 ? (
                            <>
                              <span className={`block text-[13px] font-bold ${low ? "text-amber-600 dark:text-amber-400" : "text-brand-600 dark:text-brand-400"}`}>
                                {perso.toFixed(0)} <span className="text-[9.5px] font-normal text-muted-foreground">{unit} perso</span>
                              </span>
                              <span className="block text-[10px] text-muted-foreground">{total.toFixed(0)} {unit} total</span>
                            </>
                          ) : (
                            <span className={`text-[13px] font-bold ${low ? "text-amber-600 dark:text-amber-400" : "text-emerald-600 dark:text-emerald-400"}`}>
                              {total.toFixed(0)} <span className="text-[9.5px] font-normal text-muted-foreground">{unit}</span>
                            </span>
                          )}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
