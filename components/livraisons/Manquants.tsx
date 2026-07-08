"use client";

/**
 * MANQUANTS — état COMPLET des articles en rupture (stock SAP total négatif,
 * tous entrepôts confondus) sur les commandes d'un jour de livraison.
 * Remplace l'ancien onglet « Manquants » du Détail livraison : c'est le
 * pilotage des ACHATS À PRÉVOIR, avec le détail des BL touchés par article.
 *
 * Source : GET /api/livraisons?date=YYYY-MM-DD (défaut = prochaine livraison).
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  CheckCircle2, ChevronDown, ChevronLeft, ChevronRight, Loader2, PackageX, RefreshCw, Truck,
} from "lucide-react";
import { toast } from "sonner";
import { addDaysISO, formatDeliveryDate, frenchHolidayLabel, nextDeliveryDate } from "@/lib/livraison";
import type { ApiResp, Doc } from "@/lib/livraisonView";

const NF_NUM = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 1 });
const fmtNum = (v: number) => NF_NUM.format(v);
const capitalize = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

interface MissingDocRef {
  docEntry: number; docNum: number; cardName: string;
  carrierName: string | null; colis: number; quantity: number;
}
interface MissingItem {
  itemCode: string; itemName: string; stock: number | null;
  colis: number; quantity: number; docs: MissingDocRef[];
}

/** Cumul des manquants PAR ARTICLE + les BL touchés (avec leur volume). */
function buildSummary(data: ApiResp | null): MissingItem[] {
  if (!data?.ok) return [];
  const byItem = new Map<string, MissingItem>();
  for (const car of data.carriers) for (const d of car.docs as Doc[]) {
    const codes = new Set(d.missingItems ?? []);
    if (codes.size === 0) continue;
    for (const l of d.lines) {
      if (!codes.has(l.itemCode)) continue;
      const g = byItem.get(l.itemCode) ?? {
        itemCode: l.itemCode, itemName: l.itemName,
        stock: data.negativeStocks?.[l.itemCode] ?? null,
        colis: 0, quantity: 0, docs: [],
      };
      g.colis += l.colis;
      g.quantity += l.quantity;
      g.docs.push({
        docEntry: d.docEntry, docNum: d.docNum, cardName: d.cardFullName ?? d.cardName,
        carrierName: d.carrierName, colis: l.colis, quantity: l.quantity,
      });
      byItem.set(l.itemCode, g);
    }
  }
  return [...byItem.values()].sort((a, b) => (a.stock ?? 0) - (b.stock ?? 0) || a.itemName.localeCompare(b.itemName, "fr"));
}

export function Manquants() {
  const auto = useMemo(() => nextDeliveryDate(), []);
  const [date, setDate] = useState(auto);
  const [data, setData] = useState<ApiResp | null>(null);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState<Set<string>>(new Set());

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

  const items = useMemo(() => buildSummary(data), [data]);
  const holiday = date ? frenchHolidayLabel(date) : null;
  const toggle = (code: string) =>
    setOpen((cur) => { const next = new Set(cur); if (next.has(code)) next.delete(code); else next.add(code); return next; });

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
            Aucun article des commandes de ce jour n&apos;a un disponible SAP négatif
            (stock − engagé clients, tous entrepôts confondus). Rien à racheter.
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
                Articles manquants — achats à prévoir
              </p>
              <p className="text-[11px] text-muted-foreground">
                {items.length} article{items.length > 1 ? "s" : ""} au disponible SAP négatif (stock − engagé clients)
                sur les commandes du jour · un clic déplie les BL touchés.
              </p>
            </div>
          </div>
          <table className="w-full text-[12.5px]">
            <thead className="text-[9px] uppercase tracking-wider text-muted-foreground bg-secondary/30">
              <tr>
                <th className="text-left font-semibold px-4 sm:px-5 py-1.5">Article</th>
                <th className="text-right font-semibold px-3 py-1.5 whitespace-nowrap" title="Disponible = stock détenu − engagé clients">Dispo SAP</th>
                <th className="text-right font-semibold px-3 py-1.5 whitespace-nowrap hidden sm:table-cell">Colis cmd.</th>
                <th className="text-right font-semibold px-3 py-1.5 whitespace-nowrap hidden sm:table-cell">Qté cmd.</th>
                <th className="text-right font-semibold px-4 sm:px-5 py-1.5 whitespace-nowrap">Commandes</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/50">
              {items.flatMap((it) => {
                const isOpen = open.has(it.itemCode);
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
                    <td className="px-3 py-2 text-right">
                      <span className="inline-flex min-w-[28px] items-center justify-center rounded-md bg-rose-500/12 text-rose-700 dark:text-rose-300 px-1.5 py-0.5 text-[13px] font-bold tnum">
                        {it.stock != null ? fmtNum(it.stock) : "—"}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-right tnum text-muted-foreground hidden sm:table-cell">{fmtNum(it.colis)}</td>
                    <td className="px-3 py-2 text-right tnum text-muted-foreground hidden sm:table-cell">{fmtNum(it.quantity)}</td>
                    <td className="px-4 sm:px-5 py-2 text-right tnum font-semibold text-foreground">{it.docs.length}</td>
                  </tr>,
                ];
                if (isOpen) {
                  rows.push(
                    <tr key={`${it.itemCode}-docs`}>
                      <td colSpan={5} className="bg-secondary/20 px-4 sm:px-5 py-2.5">
                        <ul className="space-y-1">
                          {it.docs.map((d) => (
                            <li key={`${it.itemCode}-${d.docEntry}`} className="flex items-center gap-2 text-[12px] flex-wrap">
                              <span className="font-medium text-foreground truncate">{d.cardName}</span>
                              <span className="text-muted-foreground tnum">BL # {d.docNum}</span>
                              <span className="text-muted-foreground tnum">{fmtNum(d.colis)} colis · {fmtNum(d.quantity)} pie</span>
                              {d.carrierName && (
                                <span className="inline-flex items-center gap-1 text-muted-foreground">
                                  <Truck className="h-3 w-3" /> {d.carrierName}
                                </span>
                              )}
                            </li>
                          ))}
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
