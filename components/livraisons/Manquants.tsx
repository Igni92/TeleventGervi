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
 * Le mode d'emploi détaillé vit dans le « ? » de l'en-tête de page — ici une
 * seule ligne de rappel (footer de la liste), pas trois répétitions.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowDown, ArrowUp, CheckCircle2, ChevronDown, RefreshCw, ShoppingCart, Truck } from "lucide-react";
import { toast } from "sonner";
import { formatDeliveryDate, frenchHolidayLabel, nextDeliveryDate } from "@/lib/livraison";
import type { ApiResp } from "@/lib/livraisonView";
import { buildShortages, reorderPriority, type ItemShortage } from "@/lib/manquants";
import { segmentBadgeClass } from "@/lib/segments";
import { DateStepper } from "@/components/ui/date-stepper";
import { GroupedList } from "@/components/ui/grouped-list";
import { EmptyState } from "@/components/ui/empty-state";
import { Banner } from "@/components/ui/banner";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";

const NF_NUM = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 1 });
const fmtNum = (v: number) => NF_NUM.format(v);
const capitalize = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

/** Ordre de priorité par article — mémorisé PAR JOUR (poste partagé, localStorage). */
const PRIO_KEY = (date: string) => `televent-manquants-prio:${date}`;

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
        <DateStepper value={date} onChange={setDate} className="shrink-0" />
        <p className="text-caption text-muted-foreground">
          {capitalize(formatDeliveryDate(date))}
          {date === auto && <span className="ml-1.5 font-semibold text-brand-600 dark:text-brand-400">· prochaine livraison</span>}
          {holiday && <span className="ml-1.5 font-semibold text-warning">· férié : {holiday}</span>}
        </p>
        <Button variant="outline" size="lg" onClick={() => load(date)} disabled={loading} className="ml-auto shrink-0">
          <RefreshCw className={loading ? "animate-spin" : ""} />
          <span className="hidden sm:inline">Actualiser</span>
        </Button>
      </div>

      {/* ── Données partielles : au moins un lot de stock SAP a échoué ── */}
      {data?.partial && (
        <Banner tone="warning" title="Données partielles">
          Le stock de certains articles n&apos;a pas pu être lu
          {data.failedChunks ? <> ({data.failedChunks} lot{data.failedChunks > 1 ? "s" : ""} en échec)</> : null}.
          Des manquants peuvent être <b>sous-estimés</b> : réactualise dans un instant.
        </Banner>
      )}

      {/* ── Contenu ── */}
      {loading && !data ? (
        <div role="status" aria-label="Analyse des commandes du jour">
          <Skeleton className="mb-2 ml-4 h-3.5 w-40" />
          <div className="divide-y divide-border overflow-hidden rounded-xl bg-card ring-1 ring-border">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="flex items-center gap-3 px-4 py-3">
                <div className="min-w-0 flex-1 space-y-1.5">
                  <Skeleton className="h-3.5 w-1/2" />
                  <Skeleton className="h-3 w-2/3" />
                </div>
                <Skeleton className="h-4 w-10" />
              </div>
            ))}
          </div>
        </div>
      ) : items.length === 0 ? (
        <EmptyState
          icon={CheckCircle2}
          title="Aucun manquant"
          description="Le stock détenu couvre toutes les commandes de ce jour. Rien à racheter."
          className="rounded-xl bg-card ring-1 ring-border"
        />
      ) : (
        <section
          aria-label="Articles à acheter"
          className={`transition-opacity ${loading ? "opacity-60" : ""}`}
        >
          {/* En-tête AU-DESSUS de la surface (motif GroupedList) — toujours
              visible, y compris sur mobile (pas .kicker). */}
          <div className="mb-1.5 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 px-4">
            <h2 className="text-body font-semibold text-foreground">À acheter</h2>
            <p className="tnum text-caption text-muted-foreground">
              {toBuyTotal} article{toBuyTotal > 1 ? "s" : ""} · demande du jour &gt; stock détenu
            </p>
          </div>
          <GroupedList footer="Déplie un article pour répartir le stock détenu entre les commandes — les flèches règlent la priorité (le stock sert d'abord les commandes du haut).">
            {items.map((it) => {
              const isOpen = open.has(it.itemCode);
              const servedOrders = it.orders.filter((o) => o.toBuy <= 0).length;
              return (
                <div key={it.itemCode}>
                  {/* Rangée article — dépliable. Bouton propre (pas GroupedRow) :
                      le panneau contient des boutons (flèches), imbrication interdite. */}
                  <button
                    type="button"
                    onClick={() => toggle(it.itemCode)}
                    aria-expanded={isOpen}
                    className="flex min-h-11 w-full items-center gap-3 px-4 py-2.5 text-left transition-colors duration-[var(--dur-fast)] ease-[var(--ease-apple)] hover:bg-secondary/60 active:bg-secondary focus-visible:bg-secondary/60 focus-visible:outline-none"
                  >
                    <ChevronDown
                      size={16}
                      aria-hidden
                      className={`shrink-0 text-muted-foreground transition-transform ${isOpen ? "" : "-rotate-90"}`}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="flex min-w-0 items-baseline gap-1.5">
                        <span className="truncate text-body font-medium text-foreground">{it.itemName}</span>
                        <span className="hidden shrink-0 font-mono text-caption2 text-muted-foreground/70 sm:inline">{it.itemCode}</span>
                      </span>
                      <span className="tnum mt-0.5 block text-caption text-muted-foreground">
                        En stock {fmtNum(it.onHand)} · demandé {fmtNum(it.demand)} · {it.orders.length} commande{it.orders.length > 1 ? "s" : ""}
                        {servedOrders > 0 && <> · {servedOrders} servie{servedOrders > 1 ? "s" : ""}</>}
                      </span>
                    </span>
                    {/* Seule couleur de la rangée : le reliquat à acheter (état bloquant). */}
                    <span className="shrink-0 text-right">
                      <span className="tnum block text-body font-semibold text-destructive">{fmtNum(it.toBuy)}</span>
                      <span className="block text-caption2 text-muted-foreground">à acheter</span>
                    </span>
                  </button>

                  {isOpen && (
                    <ul className="space-y-1 border-t border-border/60 bg-secondary/30 px-3 py-2.5 sm:px-4">
                      {it.orders.map((o, idx) => {
                        const complete = o.toBuy <= 0;
                        return (
                          <li
                            key={`${it.itemCode}-${o.docEntry}`}
                            className="flex items-center gap-2 rounded-lg bg-card px-2.5 py-1.5 ring-1 ring-border"
                          >
                            {/* Flèches de priorité */}
                            <span className="flex shrink-0 flex-col">
                              <button
                                type="button"
                                onClick={() => move(it, o.docEntry, -1)}
                                disabled={idx === 0}
                                aria-label="Monter la priorité"
                                title="Prioriser (servir plus tôt)"
                                className="inline-flex h-4 w-5 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-secondary/60 hover:text-foreground disabled:opacity-25 disabled:hover:bg-transparent"
                              ><ArrowUp className="h-3 w-3" /></button>
                              <button
                                type="button"
                                onClick={() => move(it, o.docEntry, 1)}
                                disabled={idx === it.orders.length - 1}
                                aria-label="Descendre la priorité"
                                title="Déprioriser (servir plus tard)"
                                className="inline-flex h-4 w-5 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-secondary/60 hover:text-foreground disabled:opacity-25 disabled:hover:bg-transparent"
                              ><ArrowDown className="h-3 w-3" /></button>
                            </span>
                            <span className="tnum w-5 shrink-0 text-right text-caption2 font-semibold text-muted-foreground">{idx + 1}.</span>
                            <span className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5 text-caption">
                              <span className="truncate font-medium text-foreground">{o.cardName}</span>
                              {o.clientType && (
                                <span className={`inline-flex shrink-0 items-center rounded px-1 py-px text-caption2 font-semibold uppercase tracking-wide ${segmentBadgeClass(o.clientType)}`}>
                                  {o.clientType}
                                </span>
                              )}
                              <span className="tnum text-muted-foreground">BL n° {o.docNum}</span>
                              {o.carrierName && (
                                <span className="inline-flex items-center gap-1 text-muted-foreground">
                                  <Truck className="h-3 w-3" /> {o.carrierName}
                                </span>
                              )}
                            </span>
                            {/* Demandé / servi / à acheter — couleur = état uniquement
                                (vert servi·complète, rouge reliquat à acheter). */}
                            <span className="tnum flex shrink-0 items-center gap-2.5 text-caption">
                              <span className="text-muted-foreground" title="Quantité demandée">{fmtNum(o.qty)}</span>
                              <span className="font-semibold text-success" title="Servi avec le stock détenu">
                                ✓ {fmtNum(o.served)}
                              </span>
                              {complete ? (
                                <span className="text-caption2 font-semibold text-success">complète</span>
                              ) : (
                                <span className="inline-flex items-center gap-1 font-bold text-destructive" title="Reliquat à acheter">
                                  <ShoppingCart className="h-3 w-3" /> {fmtNum(o.toBuy)}
                                </span>
                              )}
                            </span>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </div>
              );
            })}
          </GroupedList>
        </section>
      )}
    </div>
  );
}
