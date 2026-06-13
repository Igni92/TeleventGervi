"use client";

import { useState, useEffect, useCallback } from "react";
import { Search, Loader2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { InfoTip } from "@/components/ui/info-tip";
import { personalStock, unitInfo } from "@/lib/gervifrais-calc";

interface StockEntry { inStock: number; committed: number; ordered: number; available: number; }
interface Product {
  id: string;
  itemCode: string;
  itemName: string;
  groupName: string | null;
  salesUnit: string | null;
  salesPackagingUnit: string | null;
  salesQtyPerPackUnit: number | null;
  salesUnitWeight: number | null;
  // Détails métier — chips visibles (pas grisés)
  uMarque: string | null; uPays: string | null; uCondi: string | null; uUvc: string | null;
  totalStock: number;
  stockByWarehouse: Record<string, StockEntry>;
}


/**
 * Compact stock lookup for the Console active client view.
 * Search-as-you-type → shows top 5 matching products with their per-warehouse stock.
 * Designed for in-call use: tap a product code/name, see if you can promise it.
 */
export function StockLookup({ sharePct = 100 }: { sharePct?: number }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Product[]>([]);
  const [loading, setLoading] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);

  const fetch5 = useCallback(async (q: string) => {
    if (!q.trim()) { setResults([]); setHasSearched(false); return; }
    setLoading(true);
    try {
      const params = new URLSearchParams({
        search: q.trim(),
        inStock: "true",  // pendant l'appel on n'a pas envie de voir ce qui est en rupture
        limit: "5",
      });
      const res = await fetch(`/api/products?${params}`);
      const json = await res.json();
      setResults(json.products ?? []);
      setHasSearched(true);
    } catch {
      setResults([]);
    } finally {
      setLoading(false);
    }
  }, []);

  // Debounced search
  useEffect(() => {
    const t = setTimeout(() => fetch5(query), 220);
    return () => clearTimeout(t);
  }, [query, fetch5]);

  return (
    <div className="space-y-3">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Code ou nom produit (ex. FRAMB, Fraise)…"
          className="pl-9 h-9 text-[13px]"
        />
        {loading && (
          <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 animate-spin text-muted-foreground" />
        )}
      </div>

      {hasSearched && results.length === 0 && !loading && (
        <p className="text-[12px] italic text-muted-foreground py-2">
          Aucun produit en stock pour « {query} ».
        </p>
      )}

      {results.length > 0 && (
        <ul className="space-y-1.5">
          {results.map((p) => {
            const r1 = p.stockByWarehouse["R1"];
            const w01 = p.stockByWarehouse["01"];
            const w000 = p.stockByWarehouse["000"];
            const { packDivisor, displayUnit: unit } = unitInfo(p.salesUnit, p.salesQtyPerPackUnit);
            const totalDispo = [r1, w01, w000].reduce((s, e) => s + (e?.available ?? 0), 0) / packDivisor;
            const perso = personalStock(totalDispo, sharePct);
            return (
              <li
                key={p.id}
                className="rounded-lg border border-border bg-card/50 px-3 py-2 hover:bg-secondary/40 transition-colors"
              >
                <div className="flex items-baseline justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-[13px] font-semibold text-foreground truncate tracking-tight">
                      {p.itemName}
                    </p>
                    {(p.uMarque || p.uCondi || p.uUvc || p.uPays) && (
                      <span className="mt-0.5 flex items-center gap-1 flex-wrap">
                        {p.uMarque && (
                          <span className="inline-flex h-4 items-center px-1.5 rounded text-[10px] font-semibold bg-violet-100 text-violet-800 dark:bg-violet-500/30 dark:text-violet-100 dark:ring-1 dark:ring-inset dark:ring-violet-400/50">
                            {p.uMarque}
                          </span>
                        )}
                        {(p.uCondi || p.uUvc) && (
                          <span className="inline-flex h-4 items-center px-1.5 rounded text-[10px] font-semibold bg-sky-100 text-sky-800 dark:bg-sky-500/30 dark:text-sky-100 dark:ring-1 dark:ring-inset dark:ring-sky-400/50">
                            {p.uCondi ?? p.uUvc}
                          </span>
                        )}
                        {p.uPays && (
                          <span className="inline-flex h-4 items-center px-1.5 rounded text-[10px] font-semibold bg-amber-100 text-amber-800 dark:bg-amber-500/30 dark:text-amber-100 dark:ring-1 dark:ring-inset dark:ring-amber-400/50">
                            {p.uPays}
                          </span>
                        )}
                      </span>
                    )}
                    <p className="text-[10px] font-mono text-muted-foreground/70 mt-0.5">
                      {p.itemCode}
                      {p.groupName && <span className="font-sans"> · {p.groupName}</span>}
                    </p>
                  </div>
                  <div className="text-right shrink-0">
                    {/* Stock perso (prioritaire si % < 100) */}
                    {sharePct < 100 && (
                      <span className="block text-[14px] font-bold tnum text-brand-600 dark:text-brand-400">
                        {packDivisor > 1 ? Math.floor(perso) : perso.toFixed(0)} <span className="text-[10px] font-normal text-muted-foreground">{unit} perso</span>
                      </span>
                    )}
                    <span className={`block tnum ${sharePct < 100 ? "text-[11px] text-muted-foreground" : "text-[14px] font-bold text-emerald-600 dark:text-emerald-400"}`}>
                      {packDivisor > 1 ? Math.floor(totalDispo) : totalDispo.toFixed(0)} <span className="text-[10px] font-normal text-muted-foreground">{unit} {sharePct < 100 ? "total" : "dispo"}</span>
                    </span>
                  </div>
                </div>
                {/* Stock par entrepôt — 1 ligne compacte */}
                <div className="flex items-center gap-3 mt-1.5 text-[10.5px] font-mono tnum text-muted-foreground">
                  <StockChip code="R1" entry={r1} divisor={packDivisor} highlight tip="J+1 — livraison demain" />
                  <StockChip code="01" entry={w01} divisor={packDivisor} tip="Stock physique" />
                  <StockChip code="000" entry={w000} divisor={packDivisor} tip="A/C-A/D — réception" />
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {!hasSearched && !loading && (
        <p className="text-[11.5px] text-muted-foreground italic">
          Cherche un produit pour voir s&apos;il est disponible avant de le proposer au client.
        </p>
      )}
    </div>
  );
}

function StockChip({
  code, entry, divisor = 1, highlight, tip,
}: { code: string; entry?: StockEntry; divisor?: number; highlight?: boolean; tip: string }) {
  if (!entry || entry.available <= 0) {
    return (
      <span className="opacity-40">
        <span className="font-semibold">{code}</span>: —
      </span>
    );
  }
  const available = entry.available / divisor;
  const isLow = available <= 5;
  // Règle métier : pas de demi-colis affiché → floor en Colis.
  const fmt = divisor > 1 ? Math.floor(available).toString() : available.toFixed(0);
  return (
    <InfoTip label={`Entrepôt ${code}`} content={tip} side="top" iconSize={9}>
      <span className={`inline-flex items-center gap-1 ${
        highlight ? "text-brand-600 dark:text-brand-400 font-semibold" : "text-foreground"
      }`}>
        <span className="font-semibold">{code}</span>:
        <span className={isLow ? "text-amber-600 dark:text-amber-400 font-semibold" : "font-semibold"}>
          {fmt}
        </span>
      </span>
    </InfoTip>
  );
}
