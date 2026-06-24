"use client";

import { useEffect, useState, useCallback } from "react";
import { createPortal } from "react-dom";
import { toast } from "sonner";
import {
  Search, RefreshCw, Loader2, Package, ChevronLeft, ChevronRight,
  AlertTriangle, Check, ChevronDown, Scale, X, LayoutGrid,
} from "lucide-react";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { InfoTip } from "@/components/ui/info-tip";
import { SortArrow, nextSort, type SortDir } from "@/components/ui/sort";
import { AnimatedNumber } from "@/components/ui/animated-number";
import { formatRelative } from "@/lib/utils";
import { convertStockDisplay, type StockDisplayUnit } from "@/lib/gervifrais-calc";
import { designationProduit } from "@/lib/produit-designation";

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
  // Désignation décomposée (champs custom Gervifrais)
  uPays: string | null;
  uMarque: string | null;
  uCondi: string | null;
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

const REFRESH_INTERVAL = 90 * 1000; // 90 s — sync delta SAP + refetch DB locale (serveur throttle déjà à 20 s)

export function ProductsTable() {
  const [data, setData] = useState<Response | null>(null);
  const [last, setLast] = useState<LastSyncInfo | null>(null);
  const [groups, setGroups] = useState<ProductGroup[]>([]);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [sort, setSort] = useState<{ key: string | null; dir: SortDir }>({ key: null, dir: "asc" });
  const [inStockOnly, setInStockOnly] = useState(true);
  const [selectedGroups, setSelectedGroups] = useState<Set<number>>(new Set());
  // Unité d'affichage du stock par groupe (kg/colis/pièce) — surcharge le mode auto.
  const [groupUnits, setGroupUnits] = useState<Record<string, StockDisplayUnit>>({});
  const [isAdmin, setIsAdmin] = useState(false);
  const [unitModalOpen, setUnitModalOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  // Rows expanded to show batches
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [batches, setBatches] = useState<Record<string, Batch[] | "loading">>({});
  // Groupes repliés sur la liste mobile (style Écran 2 — sections par famille).
  const [closedGroups, setClosedGroups] = useState<Set<string>>(new Set());
  // Jours de livraison des commandes fournisseurs ouvertes, par article (survol
  // de la colonne « Commande fournisseur »). itemCode → "24.06 (480) · 26.06 (120)".
  const [poDuesByItem, setPoDuesByItem] = useState<Record<string, string>>({});

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
      // Tri serveur (clic sur en-tête) — sinon tri par défaut (plus gros stock).
      if (sort.key) { params.set("sort", sort.key); params.set("dir", sort.dir); }
      const res = await fetch(`/api/products?${params}`);
      if (!res.ok) throw new Error();
      setData(await res.json());
    } catch {
      toast.error("Erreur de chargement");
    } finally {
      setLoading(false);
    }
  }, [search, page, inStockOnly, selectedGroups, sort]);

  const fetchGroups = useCallback(async () => {
    try {
      const res = await fetch("/api/products/groups");
      if (res.ok) setGroups((await res.json()).groups ?? []);
    } catch { /* silent */ }
  }, []);

  // Dates de livraison des commandes fournisseurs OUVERTES, regroupées par article
  // (plusieurs lots/commandes → plusieurs jours). Sert d'infobulle sur la quantité
  // « Commande fournisseur ».
  const fetchPoDues = useCallback(async () => {
    try {
      const res = await fetch("/api/sap/purchase-orders?last=60", { cache: "no-store" });
      if (!res.ok) return;
      const json = await res.json();
      type PoLine = { itemCode: string; pieceQuantity?: number; packageQuantity?: number | null; open?: boolean };
      type Po = { dueDate: string | null; open: boolean; lines?: PoLine[] };
      const byItem: Record<string, { due: string; qty: number }[]> = {};
      for (const po of (json.docs ?? []) as Po[]) {
        if (!po.open || !po.dueDate) continue;
        const d = new Date(po.dueDate);
        const due = Number.isNaN(d.getTime()) ? "?" : `${String(d.getDate()).padStart(2, "0")}.${String(d.getMonth() + 1).padStart(2, "0")}`;
        for (const l of (po.lines ?? [])) {
          if (l.open === false) continue;
          const qty = l.packageQuantity ?? l.pieceQuantity ?? 0;
          (byItem[l.itemCode] ??= []).push({ due, qty });
        }
      }
      const out: Record<string, string> = {};
      for (const [code, arr] of Object.entries(byItem)) {
        // 1 ligne par jour de livraison (agrégé), trié par date.
        const perDay = new Map<string, number>();
        for (const { due, qty } of arr) perDay.set(due, (perDay.get(due) ?? 0) + qty);
        out[code] = Array.from(perDay.entries())
          .sort((a, b) => a[0].localeCompare(b[0]))
          .map(([due, qty]) => `${due} (${Math.round(qty * 10) / 10})`)
          .join(" · ");
      }
      setPoDuesByItem(out);
    } catch { /* infobulle optionnelle */ }
  }, []);

  const fetchLastSync = useCallback(async () => {
    try {
      const res = await fetch("/api/sap/sync/products");
      if (res.ok) setLast(await res.json());
    } catch { /* silent */ }
  }, []);

  const fetchGroupUnits = useCallback(async () => {
    try {
      const res = await fetch("/api/products/group-units");
      if (res.ok) {
        const j = await res.json();
        setGroupUnits(j.units ?? {});
        setIsAdmin(!!j.isAdmin);
      }
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
  useEffect(() => { fetchPoDues(); }, [fetchPoDues]);
  useEffect(() => { fetchGroupUnits(); }, [fetchGroupUnits]);

  // Reset page when filter changes
  useEffect(() => { setPage(1); }, [search, inStockOnly, selectedGroups, sort]);

  // Clic sur un en-tête → bascule asc/desc/défaut (et revient page 1 via l'effet ci-dessus).
  const toggleSort = (key: string) => setSort((cur) => nextSort(cur, key));

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
      {/* ── Sync status bar (masquée sur mobile : bruit technique) ── */}
      <div className="hidden md:flex bg-card border border-border border-l-4 border-l-brand-500 rounded-xl p-4 flex-wrap items-center gap-4">
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
        <div className="relative w-full sm:flex-1 sm:max-w-md">
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

        {isAdmin && (
          <button
            type="button"
            onClick={() => setUnitModalOpen(true)}
            className="ml-auto inline-flex items-center gap-1.5 h-8 px-3 rounded-md text-[12px] font-medium bg-card border border-border text-foreground/80 hover:border-brand-500/50 hover:text-foreground transition-colors focus-visible:ring-2 focus-visible:ring-brand-500 focus:outline-none"
            title="Choisir l'unité d'affichage du stock par groupe article"
          >
            <Scale className="h-3.5 w-3.5" /> Unité d&apos;affichage
          </button>
        )}

        {data && (
          <span className={`text-[12px] text-muted-foreground tnum ${isAdmin ? "" : "ml-auto"}`}>
            {data.total} produit{data.total > 1 ? "s" : ""}
          </span>
        )}
      </div>

      {/* ── MOBILE : groupes en menu déroulant (les puces horizontales débordaient
            et étaient coupées hors-écran). Multi-sélection conservée. ── */}
      {groups.length > 0 && (() => {
        const allCount = groups.reduce((s, g) => s + g.count, 0);
        const groupLabel =
          selectedGroups.size === 0 ? "Tous les groupes"
          : selectedGroups.size === 1 ? (groups.find((g) => selectedGroups.has(g.id))?.name ?? "1 groupe")
          : `${selectedGroups.size} groupes`;
        return (
          <div className="md:hidden">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button className="w-full inline-flex items-center justify-between gap-2 h-10 px-3.5 rounded-xl border border-border bg-card text-[13.5px] font-medium text-foreground active:bg-secondary/40 transition-colors">
                  <span className="inline-flex items-center gap-2 min-w-0">
                    <LayoutGrid className="h-4 w-4 text-muted-foreground shrink-0" />
                    <span className="truncate">{groupLabel}</span>
                  </span>
                  <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-[calc(100vw-2rem)] max-w-sm max-h-[60vh] overflow-y-auto">
                <DropdownMenuLabel className="text-[10.5px] uppercase tracking-wider text-muted-foreground">
                  Filtrer par groupe
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onSelect={(e) => { e.preventDefault(); setSelectedGroups(new Set()); }}
                  className="cursor-pointer flex items-center gap-2 text-[13.5px]"
                >
                  <span className="flex-1">Tous les groupes</span>
                  <span className="tnum text-muted-foreground text-[12px]">{allCount}</span>
                  {selectedGroups.size === 0 && <Check className="h-4 w-4 text-brand-500" />}
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                {groups.map((g) => {
                  const checked = selectedGroups.has(g.id);
                  return (
                    <DropdownMenuItem
                      key={g.id}
                      onSelect={(e) => {
                        e.preventDefault();
                        setSelectedGroups((cur) => {
                          const next = new Set(cur);
                          if (next.has(g.id)) next.delete(g.id); else next.add(g.id);
                          return next;
                        });
                      }}
                      className="cursor-pointer flex items-center gap-2 text-[13.5px]"
                    >
                      <span className="flex-1 truncate">{g.name}</span>
                      <span className="tnum text-muted-foreground text-[12px]">{g.count}</span>
                      {checked && <Check className="h-4 w-4 text-brand-500" />}
                    </DropdownMenuItem>
                  );
                })}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        );
      })()}

      {/* ── DESKTOP : puces horizontales — groupes avec ≥ 1 produit en stock ── */}
      {groups.length > 0 && (
        <div className="hidden md:flex items-center gap-2 overflow-x-auto pb-1 -mb-1 scrollbar-thin">
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

      {/* ── Mobile : stock en SECTIONS par famille (style Écran 2) — dispo à
            gauche, désignation + chips colorés (marque/condt/origine) à droite. ── */}
      <div className="md:hidden space-y-3">
        {loading && !data?.products.length ? (
          <div className="h-32 flex items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
        ) : !data?.products.length ? (
          <p className="text-center text-muted-foreground py-10 text-[15px]">
            {last?.totalProducts === 0 ? "Aucun produit — lance un premier sync sur ordinateur." : "Aucun produit ne correspond aux filtres."}
          </p>
        ) : (
          (() => {
            // Regroupe la page courante par famille (groupName), ordre alpha.
            const byGroup = new Map<string, Product[]>();
            for (const p of data.products) {
              const g = p.groupName?.trim() || "Autres";
              const arr = byGroup.get(g);
              if (arr) arr.push(p); else byGroup.set(g, [p]);
            }
            const chip = "inline-flex items-center px-2 py-0.5 rounded-[5px] text-[11px] font-semibold";
            return Array.from(byGroup.entries())
              .sort(([a], [b]) => a.localeCompare(b))
              .map(([groupName, prods]) => {
                const isClosed = closedGroups.has(groupName);
                return (
                  <div key={groupName} className="rounded-2xl border border-border bg-card overflow-hidden">
                    {/* En-tête de famille (repliable) */}
                    <button
                      type="button"
                      onClick={() => setClosedGroups((cur) => {
                        const next = new Set(cur);
                        if (next.has(groupName)) next.delete(groupName); else next.add(groupName);
                        return next;
                      })}
                      className="w-full flex items-center gap-2 px-3.5 py-2.5 bg-secondary/40 border-b border-border text-left active:bg-secondary/60"
                    >
                      <ChevronDown className={`h-4 w-4 text-muted-foreground shrink-0 transition-transform ${isClosed ? "-rotate-90" : ""}`} />
                      <span className="text-[13.5px] font-semibold text-foreground">{groupName}</span>
                      <span className="text-[11px] tnum text-muted-foreground">({prods.length})</span>
                    </button>

                    {!isClosed && (
                      <div className="divide-y divide-border/60">
                        {prods.map((p) => {
                          const unit = (p.itemGroup != null ? groupUnits[String(p.itemGroup)] : undefined) ?? null;
                          const dz = designationProduit({ itemName: p.itemName, uPays: p.uPays, uMarque: p.uMarque, uCondi: p.uCondi });
                          const totalAvailable = ["000", "01", "R1"].reduce((s, w) => s + (p.stockByWarehouse[w]?.available ?? 0), 0);
                          const totalOrdered = ["000", "01", "R1"].reduce((s, w) => s + (p.stockByWarehouse[w]?.ordered ?? 0), 0);
                          const stockD = stockDisplay(p, totalAvailable, unit);
                          const orderD = stockDisplay(p, totalOrdered, unit);
                          const fmtQty = (n: number, whole: boolean) => (whole ? Math.floor(n).toString() : n.toFixed(0));
                          const isExpanded = expandedId === p.id;
                          const noStock = stockD.qty <= 0;
                          const attendu = orderD.qty > 0 ? `+${fmtQty(orderD.qty, orderD.whole)} ${orderD.label} en achat` : "";
                          return (
                            <div key={p.id}>
                              <button
                                type="button"
                                onClick={() => { if (p.manageBatch) toggleExpand(p.id); }}
                                className={`w-full grid items-center gap-3 px-3 py-2.5 text-left ${p.manageBatch ? "active:bg-secondary/30" : "cursor-default"} ${noStock ? "bg-rose-50/40 dark:bg-rose-950/15" : ""}`}
                                style={{ gridTemplateColumns: "60px minmax(0,1fr) auto" }}
                              >
                                {/* Dispo à GAUCHE */}
                                <span className="flex flex-col items-center text-center leading-none">
                                  {noStock ? (
                                    <>
                                      <span className="text-[15px] font-bold text-rose-600 dark:text-rose-400">À déc.</span>
                                      <span className="text-[9px] font-medium uppercase tracking-wide text-rose-500/80 mt-1">à récept.</span>
                                    </>
                                  ) : (
                                    <>
                                      <span className="text-[23px] font-bold tnum tracking-tight text-foreground">{fmtQty(stockD.qty, stockD.whole)}</span>
                                      <span className="text-[9.5px] font-medium uppercase tracking-wide text-muted-foreground/70 mt-1">{stockD.label}</span>
                                    </>
                                  )}
                                </span>
                                {/* Désignation + chips colorés à DROITE */}
                                <span className="min-w-0 border-l border-border/60 pl-3">
                                  <span className="block text-[15px] font-semibold text-foreground truncate leading-tight">{dz.fruit}</span>
                                  {(dz.marque !== "—" || dz.condt !== "—" || dz.pays !== "—") && (
                                    <span className="mt-1.5 flex items-center gap-1 flex-wrap">
                                      {dz.marque !== "—" && <span className={`${chip} bg-violet-100 text-violet-800 dark:bg-violet-500/30 dark:text-violet-100 dark:ring-1 dark:ring-inset dark:ring-violet-400/50`}>{dz.marque}</span>}
                                      {dz.condt !== "—" && <span className={`${chip} bg-sky-100 text-sky-800 dark:bg-sky-500/30 dark:text-sky-100 dark:ring-1 dark:ring-inset dark:ring-sky-400/50`}>{dz.condt}</span>}
                                      {dz.pays !== "—" && <span className={`${chip} bg-amber-100 text-amber-800 dark:bg-amber-500/30 dark:text-amber-100 dark:ring-1 dark:ring-inset dark:ring-amber-400/50`}>{dz.pays}</span>}
                                    </span>
                                  )}
                                  <span className="flex items-baseline gap-2 text-[11px] mt-1 min-w-0">
                                    <span className="font-mono text-muted-foreground/60 truncate">{p.itemCode}</span>
                                    {attendu && <span className="text-sky-600 dark:text-sky-400 shrink-0 font-medium">{attendu}</span>}
                                  </span>
                                </span>
                                {p.manageBatch && (
                                  <ChevronDown className={`h-5 w-5 text-muted-foreground/50 shrink-0 transition-transform ${isExpanded ? "rotate-180" : ""}`} />
                                )}
                              </button>
                              {isExpanded && (
                                <div className="px-4 pb-4 pt-3 bg-secondary/20">
                                  <BatchList batches={batches[p.id]} product={p} />
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              });
          })()
        )}
      </div>

      {/* ── Table (desktop) — défile dans le tableau (en-tête figé) ── */}
      <div className="hidden md:block bg-card border border-border rounded-xl overflow-hidden">
        <div className="max-h-[68vh] overflow-y-auto">
        <table className="w-full text-[12.5px]">
          <thead className="sticky top-0 z-10">
            <tr className="bg-slate-50 dark:bg-slate-800 border-b border-border">
              <th className="w-8 px-2 py-3 bg-slate-50 dark:bg-slate-800"></th>
              {/* Quantités à GAUCHE : stock dispo + en achat (EM) */}
              <SortTh sortKey="qty" sort={sort} onSort={toggleSort} align="right">
                Qté stock
                <InfoTip label="Quantité en stock" content="Somme des dispos sur 000 + 01 + R1 (dispo = stock − réservé)." side="bottom" iconSize={10} />
              </SortTh>
              <th className="text-right px-3 py-3 text-[10.5px] font-semibold uppercase tracking-wider text-muted-foreground bg-slate-50 dark:bg-slate-800">
                <div className="inline-flex items-center gap-1 justify-end">Commande fournisseur
                  <InfoTip label="Commande fournisseur" content="Quantité en commande fournisseur (en attente). Dès la réception (entrée marchandise), elle passe en stock." side="bottom" iconSize={10} />
                </div>
              </th>
              <SortTh sortKey="code" sort={sort} onSort={toggleSort}>Code Article</SortTh>
              <SortTh sortKey="fruit" sort={sort} onSort={toggleSort}>Fruit</SortTh>
              <SortTh sortKey="pays" sort={sort} onSort={toggleSort}>Pays</SortTh>
              <SortTh sortKey="marque" sort={sort} onSort={toggleSort}>Marque</SortTh>
              <SortTh sortKey="variete" sort={sort} onSort={toggleSort}>Variété</SortTh>
              <SortTh sortKey="condt" sort={sort} onSort={toggleSort}>Condt</SortTh>
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
                // Surcharge d'unité d'affichage choisie pour le groupe (sinon auto).
                const unit = (p.itemGroup != null ? groupUnits[String(p.itemGroup)] : undefined) ?? null;
                const dz = designationProduit({ itemName: p.itemName, uPays: p.uPays, uMarque: p.uMarque, uCondi: p.uCondi });
                // Quantités cumulées sur les 3 entrepôts synchronisés.
                const totalAvailable = ["000", "01", "R1"].reduce((s, w) => s + (p.stockByWarehouse[w]?.available ?? 0), 0);
                const totalOrdered = ["000", "01", "R1"].reduce((s, w) => s + (p.stockByWarehouse[w]?.ordered ?? 0), 0);
                const stockD = stockDisplay(p, totalAvailable, unit);
                const orderD = stockDisplay(p, totalOrdered, unit);
                const fmtQty = (n: number, whole: boolean) => (whole ? Math.floor(n).toString() : n.toFixed(0));
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
                    {/* Qté stock (dispo) — à gauche */}
                    <td className="px-3 py-2.5 text-right tnum font-semibold text-foreground">
                      {stockD.qty > 0 ? (
                        <>
                          {fmtQty(stockD.qty, stockD.whole)}
                          <span className="ml-1 text-[10px] text-muted-foreground/70 font-normal">{stockD.label}</span>
                        </>
                      ) : (
                        <span className="text-muted-foreground/40">0</span>
                      )}
                    </td>
                    {/* Commande fournisseur attendue — survol = jour(s) de livraison */}
                    <td
                      className={`px-3 py-2.5 text-right tnum text-sky-600 dark:text-sky-400 ${poDuesByItem[p.itemCode] ? "cursor-help" : ""}`}
                      title={poDuesByItem[p.itemCode] ? `Livraison(s) : ${poDuesByItem[p.itemCode]}` : undefined}
                    >
                      {orderD.qty > 0 ? (
                        <span className={poDuesByItem[p.itemCode] ? "underline decoration-dotted decoration-sky-400/60 underline-offset-2" : ""}>
                          {fmtQty(orderD.qty, orderD.whole)}
                          <span className="ml-1 text-[10px] text-muted-foreground/70 font-normal">{orderD.label}</span>
                        </span>
                      ) : (
                        <span className="text-muted-foreground/30">—</span>
                      )}
                    </td>
                    <td className="px-4 py-2.5 font-mono text-[11.5px] font-semibold text-foreground">{p.itemCode}</td>
                    <td className="px-3 py-2.5 text-foreground/90">{dz.fruit}</td>
                    <td className="px-3 py-2.5 text-[12px] text-muted-foreground">{dz.pays}</td>
                    <td className="px-3 py-2.5 text-[12px] text-muted-foreground">{dz.marque}</td>
                    <td className="px-3 py-2.5 text-[12px] text-muted-foreground">{dz.variete}</td>
                    <td className="px-3 py-2.5 text-[12px] text-muted-foreground">{dz.condt}</td>
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

      {unitModalOpen && (
        <StockUnitModal
          groups={groups}
          units={groupUnits}
          onClose={() => setUnitModalOpen(false)}
          onChange={(groupId, value) =>
            setGroupUnits((cur) => {
              const next = { ...cur };
              if (value === null) delete next[String(groupId)];
              else next[String(groupId)] = value;
              return next;
            })
          }
        />
      )}
    </div>
  );
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

/**
 * Quantité à afficher pour un stock `available` (unités de base SAP).
 *   - override (kg/colis/pièce choisi pour le groupe) → conversion dédiée ;
 *   - sinon mode auto historique : colis si pack, sinon unité de vente.
 * `whole` = true ⇒ on tronque (jamais de demi-colis / demi-pièce).
 */
function stockDisplay(
  p: Product, available: number, override: StockDisplayUnit | null,
): { qty: number; label: string; whole: boolean } {
  if (override) return convertStockDisplay(available, override, p);
  const div = getPackDivisor(p);
  return { qty: available / div, label: getDisplayUnit(p), whole: div > 1 };
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

/* ── Popup « Unité d'affichage du stock » par groupe article ──── */
const UNIT_OPTIONS: { value: StockDisplayUnit | null; label: string }[] = [
  { value: null, label: "Auto" },
  { value: "kg", label: "kg" },
  { value: "colis", label: "Colis" },
  { value: "piece", label: "Pièce" },
];

function StockUnitModal({
  groups, units, onClose, onChange,
}: {
  groups: ProductGroup[];
  units: Record<string, StockDisplayUnit>;
  onClose: () => void;
  onChange: (groupId: number, value: StockDisplayUnit | null) => void;
}) {
  const [savingId, setSavingId] = useState<number | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function setUnit(groupId: number, value: StockDisplayUnit | null) {
    const previous = units[String(groupId)] ?? null;
    setSavingId(groupId);
    onChange(groupId, value); // optimiste
    try {
      const r = await fetch("/api/products/group-units", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ groupId, unit: value }),
      });
      if (!r.ok) throw new Error();
    } catch {
      onChange(groupId, previous); // rollback
      toast.error("Échec de l'enregistrement de l'unité");
    } finally {
      setSavingId(null);
    }
  }

  const modal = (
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center bg-black/45 p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <div
        className="w-full max-w-lg rounded-2xl border border-border bg-card shadow-2xl flex flex-col max-h-[85vh]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-border px-5 py-3.5 shrink-0">
          <div className="min-w-0">
            <p className="text-[10px] uppercase tracking-[0.14em] font-semibold text-muted-foreground inline-flex items-center gap-1">
              <Scale className="h-3 w-3" /> Unité d&apos;affichage du stock
            </p>
            <p className="text-[12px] text-muted-foreground">
              Par groupe article — le calcul de conversion est appliqué partout.
            </p>
          </div>
          <button type="button" onClick={onClose} aria-label="Fermer" className="h-7 w-7 inline-flex items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-secondary/60">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="px-5 py-3 overflow-y-auto">
          {groups.length === 0 ? (
            <p className="text-[12.5px] text-muted-foreground py-6 text-center">Aucun groupe article.</p>
          ) : (
            <div className="space-y-1.5">
              {groups.map((g) => {
                const cur = units[String(g.id)] ?? null;
                return (
                  <div key={g.id} className="flex items-center justify-between gap-3 py-1.5">
                    <div className="min-w-0">
                      <p className="text-[12.5px] font-medium text-foreground truncate">{g.name}</p>
                      <p className="text-[10px] text-muted-foreground tnum">{g.count} article{g.count > 1 ? "s" : ""}</p>
                    </div>
                    <div className="inline-flex items-center rounded-lg bg-secondary/60 p-0.5 shrink-0">
                      {UNIT_OPTIONS.map((opt) => {
                        const active = cur === opt.value;
                        return (
                          <button
                            key={opt.label}
                            type="button"
                            disabled={savingId === g.id}
                            onClick={() => setUnit(g.id, opt.value)}
                            className={`h-7 px-2.5 rounded-md text-[11.5px] font-semibold transition-colors disabled:opacity-50 ${
                              active
                                ? "bg-brand-600 text-white shadow-[0_1px_2px_rgba(79,70,229,0.3)]"
                                : "text-foreground/70 hover:text-foreground"
                            }`}
                          >
                            {opt.label}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="border-t border-border px-5 py-3 shrink-0">
          <p className="text-[10.5px] text-muted-foreground leading-relaxed">
            <b>Auto</b> : colis si l&apos;article a un conditionnement, sinon son unité de vente.
            {" "}<b>kg</b> : poids réel. <b>Colis</b> : nombre de colis. <b>Pièce</b> : ÷ poids unitaire (salesUnitWeight).
          </p>
        </div>
      </div>
    </div>
  );

  if (typeof document === "undefined") return null;
  return createPortal(modal, document.body);
}

/** En-tête de colonne TRIABLE (Stock). Clic → asc / desc / défaut. En-tête figé
 *  (sticky) : on répète le fond pour qu'il masque les lignes au défilement. */
function SortTh({
  sortKey, sort, onSort, align = "left", children,
}: {
  sortKey: string;
  sort: { key: string | null; dir: SortDir };
  onSort: (key: string) => void;
  align?: "left" | "right";
  children: React.ReactNode;
}) {
  const active = sort.key === sortKey;
  return (
    <th className={`px-3 py-3 text-[10.5px] font-semibold uppercase tracking-wider text-muted-foreground bg-slate-50 dark:bg-slate-800 ${align === "right" ? "text-right" : "text-left"}`}>
      <button
        type="button"
        onClick={() => onSort(sortKey)}
        className={`inline-flex items-center gap-1 hover:text-foreground transition-colors ${align === "right" ? "justify-end" : ""} ${active ? "text-foreground" : ""}`}
      >
        {children}
        <SortArrow active={active} dir={sort.dir} />
      </button>
    </th>
  );
}
