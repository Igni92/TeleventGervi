"use client";

/**
 * DÉTAILS LIVRAISON — récap PAR ARTICLE de tout ce qui PART le jour J
 * (date de livraison = DocDueDate), avec les tags produit (marque ·
 * conditionnement · origine · variété) pour identifier précisément l'article,
 * et la quantité ventilée par segment GMS / CHR / EXPORT (+ total).
 *
 * ≠ Ventes du jour (qui liste les ventes SAISIES aujourd'hui, DocDate). Ici on
 * raisonne sur la date de LIVRAISON — ce qui quitte l'entrepôt ce jour-là.
 * Source : /api/livraisons?date=J (mode « due »). Consultation seule.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2, RefreshCw, Search, Package, Boxes, Truck, Printer } from "lucide-react";
import { toast } from "sonner";
import { formatDeliveryDate, nextDeliveryDate } from "@/lib/livraison";
import { DateStepper } from "@/components/ui/date-stepper";
import { printArticlesRecap } from "@/components/livraisons/printRecap";
import type { ApiResp } from "@/lib/livraisonView";

const SEGMENTS = ["GMS", "CHR", "EXPORT"] as const;
type Segment = (typeof SEGMENTS)[number];
type Metric = "colis" | "kg";

const SEG_HEAD: Record<Segment, string> = {
  GMS: "text-teal-700 dark:text-teal-300",
  CHR: "text-amber-700 dark:text-amber-300",
  EXPORT: "text-violet-700 dark:text-violet-300",
};

interface SegQty { colis: number; kg: number }
interface Row {
  itemCode: string;
  itemName: string;
  tags: string[];
  seg: Record<Segment, SegQty>;
}

const nfKg = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 });
const nfColis = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 1 });
const cleanTag = (v: string | null | undefined) => (v ?? "").trim();

export function DetailsLivraisonArticles() {
  const [date, setDate] = useState(() => nextDeliveryDate());
  const [data, setData] = useState<ApiResp | null>(null);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [metric, setMetric] = useState<Metric>("colis");

  const load = useCallback(async (d: string) => {
    setLoading(true);
    try {
      const r = await fetch(`/api/livraisons?date=${d}`, { cache: "no-store" });
      const j = await r.json().catch(() => null);
      if (j?.ok) setData(j); else toast.error(j?.error || "Livraisons indisponibles");
    } catch {
      toast.error("SAP injoignable — livraisons non chargées");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(date); }, [date, load]);

  const needle = q.trim().toLowerCase();
  const { rows, docCount } = useMemo(() => {
    const map = new Map<string, Row>();
    let docs = 0;
    if (data?.ok) {
      for (const c of data.carriers) for (const d of c.docs) {
        const seg = d.clientType as Segment | null;
        if (d.excluded || !seg || !(SEGMENTS as readonly string[]).includes(seg)) continue;
        docs++;
        for (const l of d.lines) {
          let a = map.get(l.itemCode);
          if (!a) {
            const tags = [cleanTag(l.marque), cleanTag(l.condt), cleanTag(l.pays), cleanTag(l.variete)]
              .filter((t) => t && t.toUpperCase() !== l.itemName.toUpperCase());
            a = { itemCode: l.itemCode, itemName: l.itemName, tags: [...new Set(tags)],
              seg: { GMS: { colis: 0, kg: 0 }, CHR: { colis: 0, kg: 0 }, EXPORT: { colis: 0, kg: 0 } } };
            map.set(l.itemCode, a);
          }
          a.seg[seg].colis += l.colis || 0;
          a.seg[seg].kg += l.weightKg || 0;
        }
      }
    }
    let list = [...map.values()];
    if (needle) list = list.filter((a) =>
      a.itemName.toLowerCase().includes(needle) || a.itemCode.toLowerCase().includes(needle) ||
      a.tags.some((t) => t.toLowerCase().includes(needle)));
    const val = (q2: SegQty) => (metric === "kg" ? q2.kg : q2.colis);
    const tot = (a: Row) => SEGMENTS.reduce((s, g) => s + val(a.seg[g]), 0);
    list.sort((x, y) => tot(y) - tot(x));
    return { rows: list, docCount: docs };
  }, [data, needle, metric]);

  const val = (q2: SegQty) => (metric === "kg" ? q2.kg : q2.colis);
  const fmt = (n: number) => (n <= 0 ? <span className="text-muted-foreground/40">—</span> : (metric === "kg" ? nfKg : nfColis).format(n));
  const rowTotal = (a: Row) => SEGMENTS.reduce((s, g) => s + val(a.seg[g]), 0);
  const colTotals = { GMS: 0, CHR: 0, EXPORT: 0, all: 0 };
  for (const a of rows) for (const g of SEGMENTS) { colTotals[g] += val(a.seg[g]); colTotals.all += val(a.seg[g]); }
  const unit = metric === "kg" ? "kg" : "colis";

  return (
    <div className="space-y-4">
      {/* Contrôles : date + recherche + rafraîchir */}
      <div className="flex flex-wrap items-center gap-2">
        <DateStepper value={date} onChange={setDate} className="shrink-0" />
        <div className="relative flex-1 min-w-[180px] max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Filtrer par article, marque, origine…"
            aria-label="Filtrer les articles"
            className="h-11 w-full rounded-xl border border-border bg-card pl-9 pr-3 text-[13px] focus:outline-none focus:ring-2 focus:ring-ring/40"
          />
        </div>
        <button
          type="button" onClick={() => load(date)} disabled={loading}
          className="inline-flex items-center gap-1.5 h-11 px-3 rounded-xl border border-border bg-card text-[12.5px] font-medium text-muted-foreground hover:text-foreground hover:bg-secondary/60 transition-colors disabled:opacity-60 shrink-0"
        >
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          <span className="hidden sm:inline">Actualiser</span>
        </button>
        <button
          type="button"
          onClick={() => {
            if (rows.length === 0) { toast.info("Rien à imprimer pour ce jour."); return; }
            const ok = printArticlesRecap({
              dateLabel: formatDeliveryDate(data?.date ?? date),
              unit,
              rows: rows.map((a) => ({ itemName: a.itemName, tags: a.tags, gms: val(a.seg.GMS), chr: val(a.seg.CHR), exp: val(a.seg.EXPORT), total: rowTotal(a) })),
              totals: { gms: colTotals.GMS, chr: colTotals.CHR, exp: colTotals.EXPORT, all: colTotals.all },
            });
            if (!ok) toast.error("Impression bloquée — autorise les fenêtres pop-up.");
          }}
          disabled={loading || rows.length === 0}
          className="inline-flex items-center gap-1.5 h-11 px-3 rounded-xl border border-border bg-card text-[12.5px] font-medium text-muted-foreground hover:text-foreground hover:bg-secondary/60 transition-colors disabled:opacity-60 shrink-0"
          title="Imprimer le récap par article (unité affichée)"
        >
          <Printer className="h-4 w-4" />
          <span className="hidden sm:inline">Imprimer</span>
        </button>
      </div>

      <section className="rounded-2xl border border-border bg-card overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-2 px-4 sm:px-5 py-3 border-b border-border bg-secondary/30">
          <div className="flex items-center gap-2.5 min-w-0">
            <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-brand-500/15 text-brand-600 dark:text-brand-400">
              <Package className="h-4 w-4" strokeWidth={2} />
            </span>
            <div className="min-w-0">
              <p className="text-[13.5px] font-semibold text-foreground leading-tight">
                Livraison par article{data?.date ? ` — ${formatDeliveryDate(data.date)}` : ""}
              </p>
              <p className="text-[11px] text-muted-foreground inline-flex items-center gap-1">
                <Truck className="h-3 w-3" />
                {loading && !data ? "Chargement…" : `${rows.length} article${rows.length > 1 ? "s" : ""} · ${docCount} livraison${docCount > 1 ? "s" : ""} · GMS / CHR / Export`}
              </p>
            </div>
          </div>
          <div className="inline-flex items-center gap-1 rounded-lg border border-border bg-card p-0.5 shrink-0">
            <MetricTab active={metric === "colis"} onClick={() => setMetric("colis")} icon={<Boxes className="h-3.5 w-3.5" />}>Colis</MetricTab>
            <MetricTab active={metric === "kg"} onClick={() => setMetric("kg")}>Kg</MetricTab>
          </div>
        </div>

        {loading && !data ? (
          <div className="flex items-center gap-2 px-5 py-4 text-[13px] text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Chargement des livraisons…
          </div>
        ) : rows.length === 0 ? (
          <p className="px-5 py-6 text-[13px] text-muted-foreground text-center">
            Aucune livraison GMS / CHR / Export ce jour{needle ? " pour cette recherche" : ""}.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-[12.5px]">
              <thead>
                <tr className="border-b border-border/70 text-muted-foreground">
                  <th className="text-left font-semibold py-2 pl-4 sm:pl-5 pr-3">Article</th>
                  {SEGMENTS.map((g) => (
                    <th key={g} className={`text-right font-bold py-2 px-3 uppercase tracking-wide ${SEG_HEAD[g]}`}>{g === "EXPORT" ? "Export" : g}</th>
                  ))}
                  <th className="text-right font-semibold py-2 pl-3 pr-4 sm:pr-5">Total</th>
                </tr>
              </thead>
              <tbody className="tnum">
                {rows.map((a) => (
                  <tr key={a.itemCode} className="border-b border-border/40 last:border-0 hover:bg-secondary/30 align-top">
                    <td className="py-2 pl-4 sm:pl-5 pr-3">
                      <p className="text-foreground font-medium leading-tight">{a.itemName}</p>
                      {a.tags.length > 0 && (
                        <div className="mt-0.5 flex flex-wrap gap-1">
                          {a.tags.map((t, i) => (
                            <span key={i} className="inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-medium bg-secondary/70 text-muted-foreground">{t}</span>
                          ))}
                        </div>
                      )}
                    </td>
                    {SEGMENTS.map((g) => (
                      <td key={g} className="py-2 px-3 text-right text-foreground/90">{fmt(val(a.seg[g]))}</td>
                    ))}
                    <td className="py-2 pl-3 pr-4 sm:pr-5 text-right font-bold text-foreground">{fmt(rowTotal(a))}</td>
                  </tr>
                ))}
                <tr className="border-t border-border/70 font-bold text-foreground bg-secondary/20">
                  <td className="py-2 pl-4 sm:pl-5 pr-3">Total ({unit})</td>
                  {SEGMENTS.map((g) => (
                    <td key={g} className="py-2 px-3 text-right">{fmt(colTotals[g])}</td>
                  ))}
                  <td className="py-2 pl-3 pr-4 sm:pr-5 text-right">{fmt(colTotals.all)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

function MetricTab({ active, onClick, icon, children }: { active: boolean; onClick: () => void; icon?: React.ReactNode; children: React.ReactNode }) {
  return (
    <button
      type="button" onClick={onClick} aria-pressed={active}
      className={`inline-flex items-center gap-1 h-7 px-2.5 rounded-md text-[11.5px] font-semibold transition-colors ${
        active ? "bg-brand-500/15 text-brand-700 dark:text-brand-300" : "text-muted-foreground hover:text-foreground"
      }`}
    >
      {icon}
      {children}
    </button>
  );
}
