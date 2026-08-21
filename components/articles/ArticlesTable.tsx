"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Search, Loader2, Package, Barcode, Check } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { SortArrow, nextSort, type SortDir } from "@/components/ui/sort";
import { SortTh } from "@/components/products/ProductsTable";
import { DesignationStrong, DesignationMuted } from "@/components/livraisons/ArticleDesignation";

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
  // Unités (mêmes champs que /products) — pour exprimer la dispo en COLIS.
  salesUnit: string | null;
  inventoryUnit: string | null;
  salesQtyPerPackUnit: number | null;
  totalStock: number;
  stockByWarehouse: Record<string, { available: number }>;
}

const PAGE = 60;

/**
 * Dispo exprimée dans le CONDITIONNEMENT de vente : « 510 colis » quand
 * l'article a un colisage (salesQtyPerPackUnit > 1), sinon dans son unité brute
 * (kg / pièce…). Même règle que l'écran Stock (getPackDivisor).
 */
function dispoDisplay(a: ArticleRow, avail: number): { qty: number; label: string } {
  const div = a.salesQtyPerPackUnit && a.salesQtyPerPackUnit > 1 ? a.salesQtyPerPackUnit : 1;
  if (div > 1) return { qty: Math.round(avail / div), label: "colis" };
  return { qty: Math.round(avail), label: (a.salesUnit || a.inventoryUnit || "").trim() };
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
  // Tri par colonne (client) — la liste est groupée par groupe article, le tri
  // s'applique DANS chaque groupe.
  const [sort, setSort] = useState<{ key: string | null; dir: SortDir }>({ key: null, dir: "asc" });
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

  const toggleSort = (key: string) => setSort((cur) => nextSort(cur, key));

  // Regroupe la liste par groupe article (ordre alpha), tri de colonne appliqué
  // DANS chaque groupe.
  const groups = (() => {
    const byGroup = new Map<string, ArticleRow[]>();
    for (const a of articles) {
      const g = a.groupName?.trim() || "Autres";
      const arr = byGroup.get(g);
      if (arr) arr.push(a); else byGroup.set(g, [a]);
    }
    const sortRows = (rows: ArticleRow[]) => {
      if (!sort.key) return rows;
      const dir = sort.dir === "asc" ? 1 : -1;
      const copy = [...rows];
      copy.sort((a, b) => {
        if (sort.key === "dispo") return (availOf(a) - availOf(b)) * dir;
        return a.itemName.localeCompare(b.itemName) * dir; // "article"
      });
      return copy;
    };
    return Array.from(byGroup.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([name, rows]) => [name, sortRows(rows)] as const);
  })();

  return (
    <div className="space-y-4">
      {/* Barre de filtres — alignée sur /products (recherche + « Disponible ») */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative w-full sm:flex-1 sm:max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Rechercher un article (code, désignation)…"
            className="pl-9"
          />
        </div>
        <label className="inline-flex items-center gap-2 cursor-pointer text-[12.5px]">
          <input
            type="checkbox"
            checked={inStockOnly}
            onChange={(e) => setInStockOnly(e.target.checked)}
            className="sr-only peer"
          />
          <span className={`h-4 w-4 rounded border flex items-center justify-center transition-all ${
            inStockOnly ? "bg-brand-600 border-brand-600" : "bg-card border-border"
          }`}>
            {inStockOnly && <Check className="h-3 w-3 text-white" strokeWidth={3} />}
          </span>
          <span className="text-foreground/80">Disponible uniquement</span>
        </label>
        {!loading && (
          <span className="text-[12px] text-muted-foreground tnum ml-auto">
            {total} article{total > 1 ? "s" : ""}
          </span>
        )}
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : articles.length === 0 ? (
        <div className="rounded-xl border border-border bg-card">
          <EmptyState
            icon={Package}
            title="Aucun article"
            description="Ajustez la recherche, ou synchronisez le catalogue depuis SAP (page Stock)."
          />
        </div>
      ) : (
        <>
          <div className="bg-card border border-border rounded-xl overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-[13px]">
                <thead>
                  <tr className="border-b border-border">
                    <SortTh sortKey="article" sort={sort} onSort={toggleSort}>Article</SortTh>
                    <th className="px-3 py-3 text-left text-[10.5px] font-semibold uppercase tracking-wider text-muted-foreground bg-secondary">
                      Désignation
                    </th>
                    <SortTh sortKey="dispo" sort={sort} onSort={toggleSort} align="right">Dispo</SortTh>
                  </tr>
                </thead>
                <tbody>
                  {groups.map(([groupName, rows]) => (
                    <GroupSection key={groupName} name={groupName} rows={rows} availOf={availOf} />
                  ))}
                </tbody>
              </table>
            </div>
          </div>

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

/** Section « groupe article » : en-tête gris marqué + ses rangées zébrées. */
function GroupSection({
  name, rows, availOf,
}: {
  name: string;
  rows: readonly ArticleRow[];
  availOf: (a: ArticleRow) => number;
}) {
  return (
    <>
      <tr>
        <td colSpan={3} className="bg-secondary/60 px-4 py-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground border-b border-border">
          {name} <span className="tnum text-muted-foreground/70">({rows.length})</span>
        </td>
      </tr>
      {rows.map((a, i) => {
        const avail = availOf(a);
        const d = dispoDisplay(a, avail);
        return (
          <tr key={a.id} className={`border-b border-border/40 transition-colors hover:bg-secondary/40 ${i % 2 === 1 ? "bg-muted/40" : ""}`}>
            <td className="px-4 py-2.5 align-top">
              <Link href={`/articles/${a.id}`} className="group block min-w-0">
                <span className="block truncate text-body font-semibold text-foreground group-hover:text-brand-600">{a.itemName}</span>
                <span className="block font-mono text-caption2 text-muted-foreground/60">{a.itemCode}</span>
              </Link>
            </td>
            <td className="px-3 py-2.5 align-top">
              {/* Désignation texte (marque + calibre en avant, reste muted) —
                  même langage que Stock et les livraisons, fin des chips colorés. */}
              <DesignationStrong l={{ marque: a.uMarque, calibre: a.uCalibre }} className="text-body" />
              <DesignationMuted l={{ condt: a.uCondi, variete: a.frgnName, pays: a.uPays }} className="mt-0.5 text-caption" />
            </td>
            <td className={`px-3 py-2.5 text-right align-top tnum font-semibold ${avail > 0 ? "text-success" : "text-muted-foreground/60"}`}>
              {avail > 0 ? (
                <>
                  {d.qty}
                  {d.label && <span className="ml-1 text-[10px] font-normal text-muted-foreground/70">{d.label}</span>}
                </>
              ) : (
                0
              )}
            </td>
          </tr>
        );
      })}
    </>
  );
}
