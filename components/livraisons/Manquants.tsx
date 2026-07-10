"use client";

/**
 * MANQUANTS — « faire d'abord avec ce que l'on a, puis acheter le reliquat ».
 *
 * Un article est manquant quand la DEMANDE du jour dépasse le STOCK PHYSIQUE
 * détenu (Items.QuantityOnStock, tous entrepôts). On alloue le stock aux
 * commandes selon un ordre de PRIORITÉ réglable (flèches) : les premières
 * servies sont « complètes » avec le stock, le reliquat de chaque commande =
 * « à acheter ». Total à acheter d'un article = max(0, demande − stock détenu).
 *
 * Avant : le calcul se basait sur le « disponible SAP » global (stock − TOUS les
 * engagements clients), qui incluait les engagements des AUTRES jours et
 * sur-comptait (« 6 abricots » affichés en beaucoup plus).
 *
 * Source : GET /api/livraisons?date=YYYY-MM-DD (défaut = prochaine livraison).
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowDown, ArrowUp, CheckCircle2, ChevronDown, ChevronLeft, ChevronRight,
  Loader2, PackageX, RefreshCw, ShoppingCart, Truck,
} from "lucide-react";
import { toast } from "sonner";
import { addDaysISO, formatDeliveryDate, frenchHolidayLabel, nextDeliveryDate } from "@/lib/livraison";
import type { ApiResp } from "@/lib/livraisonView";
import { buildShortages, reorderPriority, type ItemShortage } from "@/lib/manquants";

const NF_NUM = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 1 });
const fmtNum = (v: number) => NF_NUM.format(v);
const capitalize = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

/** Ordre de priorité par article — mémorisé PAR JOUR (poste partagé, localStorage). */
const PRIO_KEY = (date: string) => `televent-manquants-prio:${date}`;

const SEG_BADGE: Record<string, string> = {
  CHR: "bg-sky-100 text-sky-700 dark:bg-sky-950/60 dark:text-sky-300",
  GMS: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300",
  EXPORT: "bg-violet-100 text-violet-700 dark:bg-violet-950/60 dark:text-violet-300",
};

export function Manquants() {
  const auto = useMemo(() => nextDeliveryDate(), []);
  const [date, setDate] = useState(auto);
  const [data, setData] = useState<ApiResp | null>(null);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState<Set<string>>(new Set());
  // Priorité (ordre des commandes) réglée à la main, par article. Chargée par jour.
  const [priorityByItem, setPriorityByItem] = useState<Record<string, number[]>>({});

  const load = useCallback(async (d: string) => {
    setLoading(true);
    try {
      const r = await fetch(`/api/livraisons?date=${d}`, { cache: "no-store" });
      const j = await r.json().catch(() => null);
      if (!j?.ok) throw new Error(j?.error || "Manquants indisponibles");
      setData(j);
    } catch (e) {
      setData(null);
      toast.error(e instanceof Error ? e.message : "Manquants indisponibles");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(date); }, [date, load]);

  // Recharge l'ordre de priorité mémorisé pour ce jour.
  useEffect(() => {
    try {
      const raw = localStorage.getItem(PRIO_KEY(date));
      setPriorityByItem(raw ? JSON.parse(raw) : {});
    } catch { setPriorityByItem({}); }
  }, [date]);

  const items = useMemo(
    () => buildShortages(data?.carriers ?? [], data?.onHandStocks, priorityByItem),
    [data, priorityByItem],
  );
  const holiday = date ? frenchHolidayLabel(date) : null;
  const toBuyTotal = items.length;

  const toggle = (code: string) =>
    setOpen((cur) => { const next = new Set(cur); if (next.has(code)) next.delete(code); else next.add(code); return next; });

  // Réordonne une commande dans la priorité de SON article (flèches), puis mémorise.
  const move = useCallback((item: ItemShortage, docEntry: number, dir: -1 | 1) => {
    const current = item.orders.map((o) => o.docEntry);
    const next = reorderPriority(current, docEntry, dir);
    setPriorityByItem((prev) => {
      const merged = { ...prev, [item.itemCode]: next };
      try { localStorage.setItem(PRIO_KEY(date), JSON.stringify(merged)); } catch { /* quota */ }
      return merged;
    });
  }, [date]);

  return (
    <div className="space-y-5">
      {/* ── Jour de livraison analysé ── */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="inline-flex items-center rounded-xl border border-border bg-card overflow-hidden">
          <button
            type="button"
            onClick={() => setDate(addDaysISO(date, -1))}
            aria-label="Jour précédent"
            className="h-10 w-10 inline-flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-secondary/60 transition-colors"
          ><ChevronLeft className="h-4 w-4" /></button>
          <input
            type="date"
            value={date}
            onChange={(e) => { if (/^\d{4}-\d{2}-\d{2}$/.test(e.target.value)) setDate(e.target.value); }}
            aria-label="Jour de livraison analysé"
            className="h-10 border-x border-border bg-card px-2.5 text-[13px] font-medium focus:outline-none"
          />
          <button
            type="button"
            onClick={() => setDate(addDaysISO(date, 1))}
            aria-label="Jour suivant"
            className="h-10 w-10 inline-flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-secondary/60 transition-colors"
          ><ChevronRight className="h-4 w-4" /></button>
        </div>
        <p className="text-[12.5px] text-muted-foreground">
          {capitalize(formatDeliveryDate(date))}
          {date === auto && <span className="ml-1.5 text-[11px] font-semibold text-brand-600 dark:text-brand-400">· prochaine livraison</span>}
          {holiday && <span className="ml-1.5 text-[11px] font-semibold text-amber-600 dark:text-amber-400">· férié : {holiday}</span>}
        </p>
        <button
          type="button"
          onClick={() => load(date)}
          disabled={loading}
          className="ml-auto inline-flex items-center gap-1.5 h-10 px-3 rounded-xl border border-border bg-card text-[12.5px] font-medium text-muted-foreground hover:text-foreground hover:bg-secondary/60 transition-colors disabled:opacity-60 shrink-0"
        >
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          <span className="hidden sm:inline">Actualiser</span>
        </button>
      </div>

      {/* ── Contenu ── */}
      {loading && !data ? (
        <div className="flex items-center gap-2 px-1 py-4 text-[13px] text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Analyse des commandes du jour…
        </div>
      ) : items.length === 0 ? (
        <div className="flex flex-col items-center justify-center text-center rounded-2xl border border-dashed border-border bg-card py-12 px-6">
          <span className="inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-emerald-500/12 text-emerald-600 dark:text-emerald-400 mb-3">
            <CheckCircle2 className="h-6 w-6" strokeWidth={1.8} />
          </span>
          <p className="text-[14px] font-semibold text-foreground">Aucun manquant</p>
          <p className="text-[12.5px] text-muted-foreground mt-1 max-w-sm">
            Le stock détenu couvre toutes les commandes de ce jour. Rien à racheter.
          </p>
        </div>
      ) : (
        <section className={`rounded-2xl border border-rose-300/60 dark:border-rose-500/30 bg-card overflow-hidden transition-opacity ${loading ? "opacity-60" : ""}`}>
          <div className="flex items-center gap-2.5 px-4 sm:px-5 py-3 border-b border-rose-300/40 dark:border-rose-500/20 bg-rose-50 dark:bg-rose-900/15">
            <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-rose-500/15 text-rose-600 dark:text-rose-400">
              <PackageX className="h-4 w-4" strokeWidth={2} />
            </span>
            <div className="min-w-0">
              <p className="text-[13.5px] font-semibold text-foreground leading-tight">
                Articles à acheter — après avoir servi avec le stock
              </p>
              <p className="text-[11px] text-muted-foreground">
                {toBuyTotal} article{toBuyTotal > 1 ? "s" : ""} où la demande du jour dépasse le stock détenu ·
                déplie un article pour répartir le stock entre les commandes (flèches = priorité).
              </p>
            </div>
          </div>
          <table className="w-full text-[12.5px]">
            <thead className="text-[9px] uppercase tracking-wider text-muted-foreground bg-secondary/30">
              <tr>
                <th className="text-left font-semibold px-4 sm:px-5 py-1.5">Article</th>
                <th className="text-right font-semibold px-3 py-1.5 whitespace-nowrap" title="Stock physique détenu, tous entrepôts">En stock</th>
                <th className="text-right font-semibold px-3 py-1.5 whitespace-nowrap hidden sm:table-cell" title="Total demandé le jour (commandes ouvertes)">Demandé</th>
                <th className="text-right font-semibold px-3 py-1.5 whitespace-nowrap" title="Reliquat à acheter = demande − stock détenu">À acheter</th>
                <th className="text-right font-semibold px-4 sm:px-5 py-1.5 whitespace-nowrap">Commandes</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/50">
              {items.flatMap((it) => {
                const isOpen = open.has(it.itemCode);
                const servedOrders = it.orders.filter((o) => o.toBuy <= 0).length;
                const rows = [
                  <tr
                    key={it.itemCode}
                    onClick={() => toggle(it.itemCode)}
                    className="cursor-pointer hover:bg-secondary/25 transition-colors"
                  >
                    <td className="px-4 sm:px-5 py-2 min-w-0">
                      <span className="inline-flex items-center gap-1.5">
                        <ChevronDown className={`h-3.5 w-3.5 text-muted-foreground shrink-0 transition-transform ${isOpen ? "" : "-rotate-90"}`} />
                        <span className="font-medium text-foreground">{it.itemName}</span>
                        <span className="font-mono text-[10px] text-muted-foreground/70 hidden sm:inline">{it.itemCode}</span>
                      </span>
                    </td>
                    <td className="px-3 py-2 text-right tnum text-muted-foreground">{fmtNum(it.onHand)}</td>
                    <td className="px-3 py-2 text-right tnum text-muted-foreground hidden sm:table-cell">{fmtNum(it.demand)}</td>
                    <td className="px-3 py-2 text-right">
                      <span className="inline-flex min-w-[32px] items-center justify-center gap-1 rounded-md bg-rose-500/12 text-rose-700 dark:text-rose-300 px-1.5 py-0.5 text-[13px] font-bold tnum">
                        <ShoppingCart className="h-3 w-3" /> {fmtNum(it.toBuy)}
                      </span>
                    </td>
                    <td className="px-4 sm:px-5 py-2 text-right tnum font-semibold text-foreground">
                      {it.orders.length}
                      {servedOrders > 0 && (
                        <span className="ml-1 text-[10px] font-medium text-emerald-600 dark:text-emerald-400">· {servedOrders} servie{servedOrders > 1 ? "s" : ""}</span>
                      )}
                    </td>
                  </tr>,
                ];
                if (isOpen) {
                  rows.push(
                    <tr key={`${it.itemCode}-docs`}>
                      <td colSpan={5} className="bg-secondary/20 px-4 sm:px-5 py-2.5">
                        <p className="text-[11px] text-muted-foreground mb-2">
                          Stock détenu <b className="text-foreground tnum">{fmtNum(it.onHand)}</b> réparti sur {it.orders.length} commande{it.orders.length > 1 ? "s" : ""}
                          {" "}dans l&apos;ordre de priorité — les flèches réordonnent (le stock sert d&apos;abord les commandes du haut).
                        </p>
                        <ul className="space-y-1">
                          {it.orders.map((o, idx) => {
                            const complete = o.toBuy <= 0;
                            return (
                              <li
                                key={`${it.itemCode}-${o.docEntry}`}
                                className={`flex items-center gap-2 rounded-lg border px-2.5 py-1.5 text-[12px] ${
                                  complete
                                    ? "border-emerald-300/50 dark:border-emerald-500/25 bg-emerald-50/40 dark:bg-emerald-950/15"
                                    : "border-rose-300/50 dark:border-rose-500/25 bg-rose-50/40 dark:bg-rose-950/15"
                                }`}
                              >
                                {/* Flèches de priorité */}
                                <span className="flex flex-col shrink-0">
                                  <button
                                    type="button"
                                    onClick={() => move(it, o.docEntry, -1)}
                                    disabled={idx === 0}
                                    aria-label="Monter la priorité"
                                    title="Prioriser (servir plus tôt)"
                                    className="h-4 w-5 inline-flex items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-secondary/60 disabled:opacity-25 disabled:hover:bg-transparent transition-colors"
                                  ><ArrowUp className="h-3 w-3" /></button>
                                  <button
                                    type="button"
                                    onClick={() => move(it, o.docEntry, 1)}
                                    disabled={idx === it.orders.length - 1}
                                    aria-label="Descendre la priorité"
                                    title="Déprioriser (servir plus tard)"
                                    className="h-4 w-5 inline-flex items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-secondary/60 disabled:opacity-25 disabled:hover:bg-transparent transition-colors"
                                  ><ArrowDown className="h-3 w-3" /></button>
                                </span>
                                <span className="w-5 shrink-0 text-right tnum text-[11px] font-semibold text-muted-foreground">{idx + 1}.</span>
                                <span className="min-w-0 flex-1 flex items-center gap-1.5 flex-wrap">
                                  <span className="font-medium text-foreground truncate">{o.cardName}</span>
                                  {o.clientType && SEG_BADGE[o.clientType] && (
                                    <span className={`shrink-0 inline-flex items-center px-1 py-px rounded text-[8.5px] font-bold uppercase tracking-wide ${SEG_BADGE[o.clientType]}`}>
                                      {o.clientType}
                                    </span>
                                  )}
                                  <span className="text-muted-foreground tnum">BL # {o.docNum}</span>
                                  {o.carrierName && (
                                    <span className="inline-flex items-center gap-1 text-muted-foreground">
                                      <Truck className="h-3 w-3" /> {o.carrierName}
                                    </span>
                                  )}
                                </span>
                                {/* Demandé / servi / à acheter */}
                                <span className="shrink-0 flex items-center gap-2.5 tnum">
                                  <span className="text-muted-foreground" title="Quantité demandée">{fmtNum(o.qty)}</span>
                                  <span className="text-emerald-700 dark:text-emerald-400 font-semibold" title="Servi avec le stock détenu">
                                    ✓ {fmtNum(o.served)}
                                  </span>
                                  {complete ? (
                                    <span className="text-emerald-600 dark:text-emerald-400 text-[10.5px] font-semibold">complète</span>
                                  ) : (
                                    <span className="inline-flex items-center gap-1 text-rose-700 dark:text-rose-300 font-bold" title="Reliquat à acheter">
                                      <ShoppingCart className="h-3 w-3" /> {fmtNum(o.toBuy)}
                                    </span>
                                  )}
                                </span>
                              </li>
                            );
                          })}
                        </ul>
                      </td>
                    </tr>,
                  );
                }
                return rows;
              })}
            </tbody>
          </table>
        </section>
      )}
    </div>
  );
}
