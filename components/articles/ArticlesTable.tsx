"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Search, Loader2, Package, ChevronRight, Barcode, Boxes } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { ViewToggle, useViewMode } from "@/components/ui/view-toggle";

interface ArticleRow {
  id: string;
  itemCode: string;
  itemName: string;
  groupName: string | null;
  uPays: string | null;
  uMarque: string | null;
  uCondi: string | null;
  uCalibre: string | null;
  frgnName: string | null;
  totalStock: number;
  stockByWarehouse: Record<string, { available: number }>;
}

const PAGE = 60;

/** Chip d'attribut article — pastille discrète colorée par nature. */
function Chip({ tone, children }: { tone: "brand" | "rose" | "sky" | "amber" | "emerald"; children: React.ReactNode }) {
  const cls = {
    brand: "bg-brand-500/10 text-brand-700 ring-brand-500/20 dark:text-brand-300",
    rose: "bg-rose-500/10 text-rose-700 ring-rose-500/20 dark:text-rose-300",
    sky: "bg-sky-500/10 text-sky-700 ring-sky-500/20 dark:text-sky-300",
    amber: "bg-amber-500/10 text-amber-700 ring-amber-500/25 dark:text-amber-300",
    emerald: "bg-emerald-500/10 text-emerald-700 ring-emerald-500/20 dark:text-emerald-300",
  }[tone];
  return <span className={`inline-flex items-center rounded-md px-1.5 py-0.5 text-[10.5px] font-semibold ring-1 ${cls}`}>{children}</span>;
}

export function ArticlesTable() {
  const [articles, setArticles] = useState<ArticleRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [search, setSearch] = useState("");
  const [inStockOnly, setInStockOnly] = useState(true);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [view, setView] = useViewMode("televent-articles-view");
  const reqId = useRef(0);

  const load = useCallback(async (opts: { page: number; append: boolean }) => {
    const myReq = ++reqId.current;
    if (opts.append) setLoadingMore(true); else setLoading(true);
    try {
      const params = new URLSearchParams();
      if (search.trim()) params.set("search", search.trim());
      if (inStockOnly) params.set("inStock", "true");
      params.set("page", String(opts.page));
      params.set("limit", String(PAGE));
      params.set("sort", "fruit");
      params.set("dir", "asc");
      const res = await fetch(`/api/products?${params}`, { cache: "no-store" });
      const json = await res.json();
      if (myReq !== reqId.current) return; // réponse périmée (recherche plus récente)
      const rows: ArticleRow[] = json.products ?? [];
      setArticles((cur) => (opts.append ? [...cur, ...rows] : rows));
      setTotalPages(json.totalPages ?? 1);
      setTotal(json.total ?? rows.length);
      setPage(opts.page);
    } catch {
      if (myReq === reqId.current && !opts.append) setArticles([]);
    } finally {
      if (myReq === reqId.current) { setLoading(false); setLoadingMore(false); }
    }
  }, [search, inStockOnly]);

  // Débounce sur recherche / filtre → recharge page 1.
  useEffect(() => {
    const t = setTimeout(() => load({ page: 1, append: false }), 240);
    return () => clearTimeout(t);
  }, [load]);

  const availOf = (a: ArticleRow) =>
    Object.values(a.stockByWarehouse || {}).reduce((s, w) => s + (w.available || 0), 0);

  return (
    <div className="space-y-4">
      {/* Barre de filtres */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[220px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Rechercher un article (code, désignation)…"
            className="pl-9"
          />
        </div>
        <div className="inline-flex rounded-lg border border-border bg-card p-0.5">
          <button
            type="button"
            onClick={() => setInStockOnly(true)}
            className={`px-3 h-8 rounded-md text-[12.5px] font-medium transition-colors ${inStockOnly ? "bg-brand-500 text-white shadow-sm" : "text-muted-foreground hover:text-foreground hover:bg-secondary/60"}`}
          >
            En stock
          </button>
          <button
            type="button"
            onClick={() => setInStockOnly(false)}
            className={`px-3 h-8 rounded-md text-[12.5px] font-medium transition-colors ${!inStockOnly ? "bg-brand-500 text-white shadow-sm" : "text-muted-foreground hover:text-foreground hover:bg-secondary/60"}`}
          >
            Tout le catalogue
          </button>
        </div>
        {!loading && <span className="text-[12px] text-muted-foreground">{total} article{total > 1 ? "s" : ""}</span>}
        <div className="ml-auto"><ViewToggle value={view} onChange={setView} /></div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : articles.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border bg-card/50 py-16 text-center">
          <Package className="mx-auto h-8 w-8 text-muted-foreground/40" />
          <p className="mt-3 text-[14px] font-medium text-foreground">Aucun article</p>
          <p className="mt-1 text-[12.5px] text-muted-foreground">
            Ajustez la recherche, ou synchronisez le catalogue depuis SAP (page Stock).
          </p>
        </div>
      ) : (
        <>
          {view === "cards" ? (
          <ul className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 xl:grid-cols-3">
            {articles.map((a) => {
              const avail = availOf(a);
              return (
                <li key={a.id}>
                  <Link
                    href={`/articles/${a.id}`}
                    className="group flex h-full flex-col rounded-2xl border border-border bg-card p-4 shadow-card transition-all duration-200 hover:-translate-y-px hover:shadow-card-hover hover:border-brand-400/50"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate text-[14.5px] font-semibold text-foreground group-hover:text-brand-600">{a.itemName}</p>
                        <p className="mt-0.5 font-mono text-[11.5px] text-muted-foreground">{a.itemCode}</p>
                      </div>
                      <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground/40 transition-transform group-hover:translate-x-0.5 group-hover:text-brand-500" />
                    </div>

                    <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
                      {a.uMarque && <Chip tone="brand">{a.uMarque}</Chip>}
                      {a.frgnName && <Chip tone="rose">{a.frgnName}</Chip>}
                      {a.uCondi && <Chip tone="sky">{a.uCondi}</Chip>}
                      {a.uCalibre && <Chip tone="emerald">cal. {a.uCalibre}</Chip>}
                      {a.uPays && <Chip tone="amber">{a.uPays}</Chip>}
                    </div>

                    <div className="mt-3 flex items-center justify-between gap-2 border-t border-border/60 pt-2.5 text-[12px] text-muted-foreground">
                      <span className="inline-flex items-center gap-1.5 truncate">
                        <Boxes className="h-3.5 w-3.5 shrink-0" /> <span className="truncate">{a.groupName ?? "—"}</span>
                      </span>
                      <span className={`inline-flex items-center gap-1 font-semibold tnum ${avail > 0 ? "text-emerald-700 dark:text-emerald-400" : "text-muted-foreground/60"}`}>
                        {Math.round(avail)} <span className="text-[10.5px] font-normal">dispo</span>
                      </span>
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
          ) : (
            <ArticleListView articles={articles} availOf={availOf} />
          )}

          {page < totalPages && (
            <div className="flex justify-center pt-2">
              <Button variant="outline" size="sm" onClick={() => load({ page: page + 1, append: true })} disabled={loadingMore}>
                {loadingMore ? <Loader2 className="h-4 w-4 animate-spin" /> : <Barcode className="h-4 w-4" />}
                Charger plus ({articles.length}/{total})
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

/** Vue LISTE classique (tableau compact) des articles. */
function ArticleListView({ articles, availOf }: { articles: ArticleRow[]; availOf: (a: ArticleRow) => number }) {
  return (
    <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-card">
      <div className="overflow-x-auto">
        <table className="w-full text-[13px]">
          <thead>
            <tr className="bg-secondary/40 text-[11px] uppercase tracking-wide text-muted-foreground">
              <th className="px-3 py-2.5 text-left font-semibold">Article</th>
              <th className="px-3 py-2.5 text-left font-semibold">Code</th>
              <th className="px-3 py-2.5 text-left font-semibold">Marque</th>
              <th className="px-3 py-2.5 text-left font-semibold">Variété</th>
              <th className="px-3 py-2.5 text-left font-semibold">Condt</th>
              <th className="px-3 py-2.5 text-left font-semibold">Calibre</th>
              <th className="px-3 py-2.5 text-left font-semibold">Pays</th>
              <th className="px-3 py-2.5 text-left font-semibold">Groupe</th>
              <th className="px-3 py-2.5 text-right font-semibold">Dispo</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {articles.map((a) => {
              const avail = availOf(a);
              const cell = (v: string | null) => (v ? v : <span className="text-muted-foreground/40">—</span>);
              return (
                <tr key={a.id} className="transition-colors hover:bg-secondary/30">
                  <td className="px-3 py-2 max-w-[260px]">
                    <Link href={`/articles/${a.id}`} className="font-semibold text-foreground hover:text-brand-600 hover:underline underline-offset-2">
                      {a.itemName}
                    </Link>
                  </td>
                  <td className="px-3 py-2 font-mono text-[11.5px] text-muted-foreground">{a.itemCode}</td>
                  <td className="px-3 py-2">{cell(a.uMarque)}</td>
                  <td className="px-3 py-2">{cell(a.frgnName)}</td>
                  <td className="px-3 py-2">{cell(a.uCondi)}</td>
                  <td className="px-3 py-2">{cell(a.uCalibre)}</td>
                  <td className="px-3 py-2">{cell(a.uPays)}</td>
                  <td className="px-3 py-2 text-muted-foreground max-w-[180px] truncate">{cell(a.groupName)}</td>
                  <td className={`px-3 py-2 text-right font-semibold tnum ${avail > 0 ? "text-emerald-700 dark:text-emerald-400" : "text-muted-foreground/60"}`}>{Math.round(avail)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
