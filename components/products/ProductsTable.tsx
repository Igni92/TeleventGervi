"use client";

import { useEffect, useState, useCallback } from "react";
import { toast } from "sonner";
import {
  Search, RefreshCw, Loader2, Package, ChevronLeft, ChevronRight,
  AlertTriangle, Check, ChevronDown,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { InfoTip } from "@/components/ui/info-tip";
import { AnimatedNumber } from "@/components/ui/animated-number";
import { formatRelative } from "@/lib/utils";

interface StockEntry { inStock: number; committed: number; ordered: number; available: number; }
interface Product {
  id: string;
  itemCode: string;
  itemName: string;
  itemGroup: number | null;
  groupName: string | null;
  salesUnit: string | null;
  salesPackagingUnit: string | null;
  salesQtyPerPackUnit: number | null;
  salesUnitWeight: number | null;
  inventoryUnit: string | null;
  purchaseUnit: string | null;
  manageBatch: boolean;
  isPackaging: boolean;
  totalStock: number;
  syncedAt: string;
  stockByWarehouse: Record<string, StockEntry>;
}

interface Batch {
  id: string;
  batchNumber: string;
  warehouseCode: string | null;
  quantity: number;
  status: string | null;
  admissionDate: string | null;
  manufactureDate: string | null;
  expirationDate: string | null;
  purchasePrice: number | null;
  currency: string | null;
  supplierName: string | null;
  sourceDocNum: string | null;
}
interface Response {
  products: Product[];
  total: number; page: number; limit: number; totalPages: number;
}
interface LastSyncInfo {
  last: {
    id: string;
    status: string;
    startedAt: string;
    finishedAt: string | null;
    itemsTotal: number;
    itemsSynced: number;
    itemsSkipped: number;
    durationMs: number | null;
  } | null;
  totalProducts: number;
  productsWithStock: number;
}

interface ProductGroup { id: number; name: string; count: number }

const REFRESH_INTERVAL = 30 * 1000; // 30 s — sync delta SAP + refetch DB locale

export function ProductsTable() {
  const [data, setData] = useState<Response | null>(null);
  const [last, setLast] = useState<LastSyncInfo | null>(null);
  const [groups, setGroups] = useState<ProductGroup[]>([]);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [inStockOnly, setInStockOnly] = useState(true);
  const [selectedGroups, setSelectedGroups] = useState<Set<number>>(new Set());
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  // Rows expanded to show batches
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [batches, setBatches] = useState<Record<string, Batch[] | "loading">>({});

  const toggleExpand = useCallback(async (productId: string) => {
    if (expandedId === productId) { setExpandedId(null); return; }
    setExpandedId(productId);
    // Fetch on demand if not cached
    if (!batches[productId]) {
      setBatches((cur) => ({ ...cur, [productId]: "loading" }));
      try {
        const res = await fetch(`/api/products/${productId}/batches`);
        const json = await res.json();
        setBatches((cur) => ({ ...cur, [productId]: json.batches ?? [] }));
      } catch {
        setBatches((cur) => ({ ...cur, [productId]: [] }));
        toast.error("Erreur chargement lots");
      }
    }
  }, [expandedId, batches]);

  const fetchProducts = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        page: String(page), limit: "50",
        inStock: String(inStockOnly),
      });
      if (search.trim()) params.set("search", search.trim());
      // Multi-group filter: send as comma-separated list
      if (selectedGroups.size > 0) {
        params.set("groups", Array.from(selectedGroups).join(","));
      }
      const res = await fetch(`/api/products?${params}`);
      if (!res.ok) throw new Error();
      setData(await res.json());
    } catch {
      toast.error("Erreur de chargement");
    } finally {
      setLoading(false);
    }
  }, [search, page, inStockOnly, selectedGroups]);

  const fetchGroups = useCallback(async () => {
    try {
      const res = await fetch("/api/products/groups");
      if (res.ok) setGroups((await res.json()).groups ?? []);
    } catch { /* silent */ }
  }, []);

  const fetchLastSync = useCallback(async () => {
    try {
      const res = await fetch("/api/sap/sync/products");
      if (res.ok) setLast(await res.json());
    } catch { /* silent */ }
  }, []);

  const sync = useCallback(async () => {
    setSyncing(true);
    try {
      const res = await fetch("/api/sap/sync/products", { method: "POST" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error);
      toast.success(`✅ ${json.synced} produits synchronisés en ${(json.durationMs / 1000).toFixed(1)}s`);
      await Promise.all([fetchProducts(), fetchLastSync()]);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Erreur SAP";
      toast.error(`Échec sync: ${msg}`);
    } finally {
      setSyncing(false);
    }
  }, [fetchProducts, fetchLastSync]);

  // Initial + manual refetch on filter change
  useEffect(() => { fetchProducts(); }, [fetchProducts]);
  useEffect(() => { fetchLastSync(); }, [fetchLastSync]);
  useEffect(() => { fetchGroups(); }, [fetchGroups]);

  // Reset page when filter changes
  useEffect(() => { setPage(1); }, [search, inStockOnly, selectedGroups]);

  // Debounced search
  useEffect(() => {
    const t = setTimeout(() => fetchProducts(), 350);
    return () => clearTimeout(t);
  }, [search]); // eslint-disable-line react-hooks/exhaustive-deps

  // Sync delta SAP toutes les 30 s puis refetch — la route /sync/delta est
  // throttled côté serveur (≤ 1 pull SAP / 20 s tous clients confondus).
  useEffect(() => {
    const tick = async () => {
      try { await fetch("/api/sap/sync/delta", { method: "POST" }); } catch { /* silent */ }
      fetchProducts();
      fetchLastSync();
    };
    const t = setInterval(tick, REFRESH_INTERVAL);
    return () => clearInterval(t);
  }, [fetchProducts, fetchLastSync]);

  return (
    <div className="space-y-4">
      {/* ── Sync status bar ── */}
      <div className="bg-card border border-border border-l-4 border-l-brand-500 rounded-xl p-4 flex flex-wrap items-center gap-4">
        <div className="flex items-center gap-2 text-[12px]">
          <Package className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="text-foreground/80">
            <span className="font-semibold text-foreground tnum">
              {last?.totalProducts != null ? <AnimatedNumber value={last.totalProducts} /> : "—"}
            </span> produits en base
            {last?.productsWithStock != null && (
              <> · <span className="font-semibold text-emerald-600 dark:text-emerald-400 tnum">
                <AnimatedNumber value={last.productsWithStock} />
              </span> avec stock</>
            )}
          </span>
        </div>
        <span className="opacity-30">·</span>
        <div className="flex items-center gap-2 text-[11.5px] text-muted-foreground">
          <RefreshCw className="h-3 w-3" />
          {last?.last ? (
            <span>
              Dernière synchro :{" "}
              <span className="text-foreground font-medium">{formatRelative(last.last.finishedAt ?? last.last.startedAt)}</span>
              {last.last.durationMs && <> en {(last.last.durationMs / 1000).toFixed(1)}s</>}
              {last.last.status === "error" && (
                <span className="ml-2 inline-flex items-center gap-1 text-rose-600">
                  <AlertTriangle className="h-3 w-3" /> erreur
                </span>
              )}
              {last.last.status === "success" && (
                <span className="ml-2 inline-flex items-center gap-1 text-emerald-600">
                  <Check className="h-3 w-3" /> ok
                </span>
              )}
            </span>
          ) : (
            <span>Jamais synchronisé</span>
          )}
        </div>
        <div className="ml-auto flex items-center gap-2">
          <span className="text-[10.5px] text-muted-foreground italic">
            auto toutes les 30 s
          </span>
          <Button onClick={sync} disabled={syncing} size="sm" className="gap-1.5">
            {syncing
              ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
              : <RefreshCw className="h-3.5 w-3.5" />}
            {syncing ? "Synchro…" : "Rafraîchir maintenant"}
          </Button>
        </div>
      </div>

      {/* ── Toolbar ── */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Rechercher code ou nom produit…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
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
            inStockOnly
              ? "bg-brand-600 border-brand-600"
              : "bg-card border-slate-300 dark:border-slate-600"
          }`}>
            {inStockOnly && <Check className="h-3 w-3 text-white" strokeWidth={3} />}
          </span>
          <span className="text-foreground/80">Disponible uniquement</span>
        </label>

        {data && (
          <span className="ml-auto text-[12px] text-muted-foreground tnum">
            {data.total} produit{data.total > 1 ? "s" : ""}
          </span>
        )}
      </div>

      {/* Horizontal group pills — only groups with at least 1 product in stock */}
      {groups.length > 0 && (
        <div className="flex items-center gap-2 overflow-x-auto pb-1 -mb-1 scrollbar-thin">
          <span className="text-[10.5px] uppercase tracking-[0.14em] font-semibold text-muted-foreground shrink-0 mr-1">
            Groupes
          </span>
          <button
            onClick={() => setSelectedGroups(new Set())}
            className={`h-7 px-3 rounded-full text-[11.5px] font-medium whitespace-nowrap transition-all shrink-0 ${
              selectedGroups.size === 0
                ? "bg-brand-600 text-white shadow-[0_1px_3px_rgba(79,70,229,0.3)]"
                : "bg-card border border-border text-foreground/70 hover:border-foreground/40"
            }`}
          >
            Tous
            <span className="ml-1.5 text-[10px] tnum opacity-70">
              {groups.reduce((s, g) => s + g.count, 0)}
            </span>
          </button>
          {groups.map((g) => {
            const checked = selectedGroups.has(g.id);
            return (
              <button
                key={g.id}
                onClick={() => setSelectedGroups((cur) => {
                  const next = new Set(cur);
                  if (next.has(g.id)) next.delete(g.id); else next.add(g.id);
                  return next;
                })}
                className={`h-7 px-3 rounded-full text-[11.5px] font-medium whitespace-nowrap transition-all shrink-0 ${
                  checked
                    ? "bg-brand-600 text-white shadow-[0_1px_3px_rgba(79,70,229,0.3)]"
                    : "bg-card border border-border text-foreground/80 hover:border-brand-500/50 hover:text-foreground"
                }`}
              >
                {g.name}
                <span className={`ml-1.5 text-[10px] tnum ${checked ? "opacity-80" : "opacity-60"}`}>
                  {g.count}
                </span>
              </button>
            );
          })}
        </div>
      )}

      {/* ── Table ── */}
      <div className="bg-card border border-border rounded-xl overflow-hidden">
        <table className="w-full text-[12.5px]">
          <thead>
            <tr className="bg-slate-50/80 dark:bg-slate-800/50 border-b border-border">
              <th className="w-8 px-2 py-3"></th>
              <th className="text-left px-4 py-3 text-[10.5px] font-semibold uppercase tracking-wider text-muted-foreground">Code</th>
              <th className="text-left px-4 py-3 text-[10.5px] font-semibold uppercase tracking-wider text-muted-foreground">Nom</th>
              <th className="text-left px-4 py-3 text-[10.5px] font-semibold uppercase tracking-wider text-muted-foreground">Groupe</th>
              <th className="text-left px-2 py-3 text-[10.5px] font-semibold uppercase tracking-wider text-muted-foreground">
                <div className="inline-flex items-center gap-1">Unités
                  <InfoTip label="Unités" content={<>Vente · Stock · Achat. Cliquable si différentes (ex. vente en barquette, stock en pièce).</>} side="bottom" iconSize={10} />
                </div>
              </th>
              <th className="text-right px-3 py-3 text-[10.5px] font-semibold uppercase tracking-wider text-muted-foreground">
                <div className="inline-flex items-center gap-1">Dispo 000
                  <InfoTip label="Disponible — entrepôt 000" content="A/C et A/D · réception / dispatch initial." side="bottom" iconSize={10} />
                </div>
              </th>
              <th className="text-right px-3 py-3 text-[10.5px] font-semibold uppercase tracking-wider text-muted-foreground">
                <div className="inline-flex items-center gap-1">Dispo 01
                  <InfoTip label="Disponible — entrepôt 01" content="Stock physique principal." side="bottom" iconSize={10} />
                </div>
              </th>
              <th className="text-right px-3 py-3 text-[10.5px] font-semibold uppercase tracking-wider text-muted-foreground">
                <div className="inline-flex items-center gap-1">Dispo R1
                  <InfoTip label="Disponible — entrepôt R1" content="J+1 · pour livraison demain." side="bottom" iconSize={10} />
                </div>
              </th>
              <th className="text-right px-4 py-3 text-[10.5px] font-semibold uppercase tracking-wider text-muted-foreground">
                <div className="inline-flex items-center gap-1 justify-end">Total dispo
                  <InfoTip
                    label="Total disponible"
                    content="Somme des dispos sur 000 + 01 + R1."
                    side="bottom" iconSize={10}
                  />
                </div>
              </th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={9} className="h-32 text-center">
                  <Loader2 className="h-5 w-5 animate-spin mx-auto text-muted-foreground" />
                </td>
              </tr>
            ) : !data?.products.length ? (
              <tr>
                <td colSpan={9} className="h-32 text-center text-muted-foreground">
                  {last?.totalProducts === 0
                    ? <>Aucun produit en base — clique sur <b>Rafraîchir maintenant</b> pour lancer le premier sync.</>
                    : "Aucun produit ne correspond aux filtres."}
                </td>
              </tr>
            ) : (
              data.products.flatMap((p) => {
                const isExpanded = expandedId === p.id;
                const rows = [
                  <tr
                    key={p.id}
                    className={`border-b border-border/40 transition-colors ${
                      isExpanded ? "bg-secondary/60" : "hover:bg-secondary/40"
                    }`}
                  >
                    <td className="px-2 py-2.5 text-center">
                      {p.manageBatch ? (
                        <button
                          onClick={() => toggleExpand(p.id)}
                          aria-label="Voir les lots"
                          className="h-6 w-6 inline-flex items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-secondary/80 transition-colors"
                        >
                          <ChevronDown className={`h-3.5 w-3.5 transition-transform ${isExpanded ? "rotate-180" : ""}`} />
                        </button>
                      ) : (
                        <span className="text-muted-foreground/30 text-[10px]">—</span>
                      )}
                    </td>
                    <td className="px-4 py-2.5 font-mono text-[11.5px] font-semibold text-foreground">{p.itemCode}</td>
                    <td className="px-4 py-2.5 text-foreground/90">{p.itemName}</td>
                    <td className="px-4 py-2.5 text-[11.5px] text-muted-foreground">{p.groupName || "—"}</td>
                    <td className="px-2 py-2.5"><UnitsBadge product={p} /></td>
                    <StockCell entry={p.stockByWarehouse["000"]} product={p} />
                    <StockCell entry={p.stockByWarehouse["01"]} product={p} />
                    <StockCell entry={p.stockByWarehouse["R1"]} product={p} highlight />
                    <td className="px-4 py-2.5 text-right font-semibold tnum text-foreground">
                      {(() => {
                        const div = getPackDivisor(p);
                        // Total = somme des DISPO sur les 3 entrepôts synchronisés
                        // (et non plus le totalStock SAP global qui inclut le committed)
                        const totalAvailable = ["000", "01", "R1"].reduce(
                          (s, w) => s + (p.stockByWarehouse[w]?.available ?? 0),
                          0,
                        );
                        const total = totalAvailable / div;
                        if (total <= 0) return <span className="text-muted-foreground/50">0</span>;
                        // Règle : pas de demi-colis affiché → floor en Colis.
                        const formatted = div > 1
                          ? Math.floor(total).toString()
                          : total.toFixed(0);
                        return (
                          <>
                            {formatted}
                            <span className="ml-1 text-[10px] text-muted-foreground/70 font-normal">
                              {getDisplayUnit(p)}
                            </span>
                          </>
                        );
                      })()}
                    </td>
                  </tr>,
                ];
                if (isExpanded) {
                  rows.push(
                    <tr key={`${p.id}-batches`}>
                      <td colSpan={9} className="bg-secondary/30 px-6 py-4 border-b border-border/40">
                        <BatchList batches={batches[p.id]} product={p} />
                      </td>
                    </tr>,
                  );
                }
                return rows;
              })
            )}
          </tbody>
        </table>
      </div>

      {/* ── Pagination ── */}
      {data && data.totalPages > 1 && (
        <div className="flex items-center justify-between text-[12px]">
          <span className="text-muted-foreground">Page {data.page} / {data.totalPages}</span>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1 || loading}>
              <ChevronLeft className="h-3.5 w-3.5" /> Précédent
            </Button>
            <Button variant="outline" size="sm" onClick={() => setPage((p) => Math.min(data.totalPages, p + 1))} disabled={page >= data.totalPages || loading}>
              Suivant <ChevronRight className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

/** Format weight in kg → "125g" if < 1kg, else "1,25 kg". */
function formatWeight(kg: number | null | undefined): string | null {
  if (kg == null || kg <= 0) return null;
  if (kg < 1) return `${Math.round(kg * 1000)}g`;
  return `${kg.toFixed(2).replace(".", ",")} kg`;
}

/** Returns the pack divisor (qty per pack) if this product is sold per pack. */
function getPackDivisor(p: Product): number {
  if (p.salesPackagingUnit && p.salesQtyPerPackUnit && p.salesQtyPerPackUnit > 1) {
    return p.salesQtyPerPackUnit;
  }
  return 1;
}

/** Display unit label — "Colis" when there's a pack, else the actual unit. */
function getDisplayUnit(p: Product): string {
  if (getPackDivisor(p) > 1) return "Colis";
  return p.salesUnit || p.inventoryUnit || "";
}

/** "Colis (12 × 125g)" — explicit format requested by the user. */
function UnitsBadge({ product }: { product: Product }) {
  const sale = product.salesUnit;
  const inv = product.inventoryUnit;
  const qty = product.salesQtyPerPackUnit;
  const weightLabel = formatWeight(product.salesUnitWeight);
  const divisor = getPackDivisor(product);

  if (divisor > 1) {
    // Pack mode — "Colis (12 × 125g)" or "Colis (12 × pie)" if no weight
    const composition = weightLabel ?? sale ?? "pie";
    return (
      <InfoTip
        label="Unités"
        content={<>
          Géré en <b>Colis</b> · 1 colis = {qty} × {weightLabel ?? sale ?? "pie"}<br/>
          Étiquette SAP : {product.salesPackagingUnit ?? "—"}
        </>}
        side="top"
      >
        <span className="inline-flex items-center gap-1 text-[11px]">
          <span className="px-1.5 py-0.5 rounded bg-brand-100 dark:bg-brand-950/50 text-brand-700 dark:text-brand-300 font-semibold">
            Colis
          </span>
          <span className="text-muted-foreground tnum">
            ({qty} × {composition})
          </span>
        </span>
      </InfoTip>
    );
  }

  // Sales unit different from inventory unit (no pack)
  if (sale && inv && sale !== inv) {
    return (
      <span className="text-[11px] inline-flex items-center gap-1">
        <span className="text-foreground/80">{sale}</span>
        <span className="text-muted-foreground/50">/</span>
        <span className="text-muted-foreground italic">stock {inv}</span>
      </span>
    );
  }

  // Same unit everywhere
  return <span className="text-[11px] text-muted-foreground">{sale || inv || "—"}</span>;
}

/** Renders the list of batches under an expanded product row. */
function BatchList({
  batches, product,
}: {
  batches: Batch[] | "loading" | undefined;
  product: Product;
}) {
  if (batches === "loading" || batches === undefined) {
    return (
      <div className="text-center py-4">
        <Loader2 className="h-4 w-4 animate-spin mx-auto text-muted-foreground" />
      </div>
    );
  }
  if (batches.length === 0) {
    return (
      <p className="text-[12px] italic text-muted-foreground py-2">
        Aucun lot enregistré en SAP pour {product.itemName}.
      </p>
    );
  }
  return (
    <div className="space-y-2">
      <p className="text-[10.5px] uppercase tracking-[0.14em] font-semibold text-muted-foreground mb-2">
        Lots ({batches.length}) · {product.itemName}
      </p>
      <table className="w-full text-[12px]">
        <thead>
          <tr className="border-b border-border/60 text-[10px] uppercase tracking-wider text-muted-foreground">
            <th className="text-left py-1.5 px-2">N° Lot</th>
            <th className="text-left py-1.5 px-2">Statut</th>
            <th className="text-right py-1.5 px-2">Qté</th>
            <th className="text-left py-1.5 px-2">Entré</th>
            <th className="text-left py-1.5 px-2">Fabriqué</th>
            <th className="text-left py-1.5 px-2">DLC</th>
            <th className="text-right py-1.5 px-2">Prix achat</th>
            <th className="text-left py-1.5 px-2">BR</th>
          </tr>
        </thead>
        <tbody>
          {batches.map((b) => (
            <tr key={b.id} className="border-b border-border/30 hover:bg-card/60 transition-colors">
              <td className="py-2 px-2 font-mono font-semibold text-foreground">{b.batchNumber}</td>
              <td className="py-2 px-2">
                <BatchStatus status={b.status} />
              </td>
              <td className="py-2 px-2 text-right tnum font-medium">
                {b.quantity > 0 ? b.quantity.toFixed(0) : <span className="text-muted-foreground/40">—</span>}
              </td>
              <td className="py-2 px-2 text-foreground/80">
                <DateRelative date={b.admissionDate} />
              </td>
              <td className="py-2 px-2 text-foreground/80">
                <DateRelative date={b.manufactureDate} />
              </td>
              <td className="py-2 px-2 text-foreground/80">
                <DateRelative date={b.expirationDate} future />
              </td>
              <td className="py-2 px-2 text-right tnum font-medium">
                {b.purchasePrice != null
                  ? <span className="text-emerald-700 dark:text-emerald-400">{b.purchasePrice.toFixed(2)} {b.currency || "€"}</span>
                  : <span className="text-muted-foreground/40">—</span>}
              </td>
              <td className="py-2 px-2 text-[11px] font-mono text-muted-foreground/80">
                {b.sourceDocNum || <span className="opacity-40">—</span>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {batches.some((b) => b.purchasePrice == null) && (
        <p className="text-[10.5px] italic text-muted-foreground mt-2">
          ℹ️ Les prix d&apos;achat sont enrichis depuis les bons de réception SAP (BR) — peut être absent si la jonction n&apos;est pas trouvée.
        </p>
      )}
    </div>
  );
}

/** "il y a 2 j" / "Aujourd'hui" / "dans 3 j" — pour les dates de lots */
function DateRelative({ date, future }: { date: string | null; future?: boolean }) {
  if (!date) return <span className="text-muted-foreground/40">—</span>;
  const d = new Date(date);
  const now = new Date();
  const diffDays = Math.round(
    (new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime() -
      new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()) / 86400000,
  );
  let label: string;
  let cls = "text-foreground/80";
  if (diffDays === 0) label = "Aujourd'hui";
  else if (diffDays === -1) label = "Hier";
  else if (diffDays === 1) label = "Demain";
  else if (diffDays < 0) {
    const abs = -diffDays;
    if (abs < 7) label = `il y a ${abs} j`;
    else if (abs < 31) label = `il y a ${Math.floor(abs / 7)} sem.`;
    else if (abs < 365) label = `il y a ${Math.floor(abs / 30)} mois`;
    else label = `il y a ${Math.floor(abs / 365)} an${abs >= 730 ? "s" : ""}`;
  } else {
    if (diffDays < 7) label = `dans ${diffDays} j`;
    else if (diffDays < 31) label = `dans ${Math.floor(diffDays / 7)} sem.`;
    else label = `dans ${Math.floor(diffDays / 30)} mois`;
    if (future && diffDays <= 3) cls = "text-rose-500 dark:text-rose-400 font-medium";
    else if (future && diffDays <= 7) cls = "text-amber-600 dark:text-amber-400";
  }
  return (
    <span className={cls} title={d.toLocaleDateString("fr-FR")}>
      {label}
    </span>
  );
}

function BatchStatus({ status }: { status: string | null }) {
  if (!status) return <span className="text-muted-foreground/40 text-[10.5px]">—</span>;
  const map: Record<string, { label: string; cls: string }> = {
    bdsStatus_Released:    { label: "Libéré",    cls: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300" },
    bdsStatus_Locked:      { label: "Bloqué",    cls: "bg-rose-100 text-rose-700 dark:bg-rose-950/60 dark:text-rose-300" },
    bdsStatus_Restricted:  { label: "Restreint", cls: "bg-amber-100 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300" },
  };
  const v = map[status] ?? { label: status.replace(/^bdsStatus_/, ""), cls: "bg-secondary text-muted-foreground" };
  return <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wider ${v.cls}`}>{v.label}</span>;
}

function StockCell({
  entry, product, highlight,
}: {
  entry?: StockEntry;
  product: Product;
  highlight?: boolean;
}) {
  const divisor = getPackDivisor(product);
  if (!entry || entry.available <= 0) {
    return <td className="px-3 py-2.5 text-right text-muted-foreground/40 tnum">—</td>;
  }
  // Divide by pack qty so we display in Colis (not pieces)
  const available = entry.available / divisor;
  const isLow = available < (divisor > 1 ? 1 : 10);
  const color = isLow
    ? "text-amber-600 dark:text-amber-400"
    : highlight
    ? "text-brand-600 dark:text-brand-400 font-semibold"
    : "text-foreground";
  // Règle métier : on n'affiche jamais un demi-colis (76.8 → 76).
  // Pour les unités unitaires (kg/pièce), on garde 0 décimale (round).
  const fmt = (n: number) => divisor > 1
    ? Math.floor(n).toString()
    : n.toFixed(0);
  return (
    <td className="px-3 py-2.5 text-right tnum">
      <span className={`${color} font-semibold`}>{fmt(available)}</span>
    </td>
  );
}
