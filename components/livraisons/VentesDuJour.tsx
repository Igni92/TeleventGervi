"use client";

/**
 * VENTES DU JOUR — les ventes SAISIES aujourd'hui (jour où la commande est
 * RENTRÉE dans le système, = DocDate), quelle que soit leur date de livraison.
 * Consultation seule, groupée par TRANSPORTEUR.
 *
 * Pour chaque BL, on montre l'avancement de la préparation par deux COCHES :
 *   • « Préparé » (verte cochée quand la commande est faite) ;
 *   • « Départ »  (bleue cochée quand la commande est partie en livraison).
 * + la date de livraison prévue (souvent J+1, mais variable).
 *
 * Les BL « avoir / exclu » ne sont pas des ventes → masqués de cet état.
 * (La mise en préparation / le suivi de picking vivent dans le Détail livraison.)
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { CalendarDays, Check, Clock, Loader2, RefreshCw, Search, Store, Truck, Package, Boxes } from "lucide-react";
import { toast } from "sonner";
import { formatDeliveryDate } from "@/lib/livraison";
import type { ApiResp, Doc } from "@/lib/livraisonView";

/** Vue de l'écran : par transporteur (BL) ou par article (ventilé segments). */
type View = "transporteur" | "article";
/** Les 3 SEGMENTS demandés (et rien d'autre). */
const SEGMENTS = ["GMS", "CHR", "EXPORT"] as const;
type Segment = (typeof SEGMENTS)[number];
type Metric = "colis" | "kg";

interface SegQty { colis: number; kg: number }
interface ArticleAgg {
  itemCode: string;
  itemName: string;
  marque: string | null;
  condt: string | null;
  seg: Record<Segment, SegQty>;
}

/** Date murale Europe/Paris (le poste peut être ailleurs) — « aujourd'hui » métier. */
function parisTodayISO(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris" }).format(new Date());
}
/** « lun. 7 juil. » court, depuis un ISO (date de livraison par BL). */
function shortDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("fr-FR", {
    weekday: "short", day: "numeric", month: "short", timeZone: "UTC",
  });
}

const eur = new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR", maximumFractionDigits: 0 });

/** Même palette de segments que le Détail livraison (SEG_UI de LivraisonDetail). */
const SEGMENT_BADGE: Record<string, string> = {
  CHR: "bg-amber-100 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300",
  EXPORT: "bg-violet-100 text-violet-700 dark:bg-violet-950/60 dark:text-violet-300",
  GMS: "bg-teal-100 text-teal-700 dark:bg-teal-950/60 dark:text-teal-300",
};

interface Group { key: string; name: string; docs: Doc[] }

/** Ventes groupées par transporteur (ordre API : colis desc, « Non affecté » en
 *  dernier), hors « avoir / exclu », triées par magasin. */
function toGroups(data: ApiResp | null): Group[] {
  if (!data?.ok) return [];
  return data.carriers
    .map((c) => ({
      key: c.code ?? "__none__",
      name: c.name,
      docs: c.docs.filter((d) => !d.excluded).sort((a, b) => a.cardName.localeCompare(b.cardName, "fr")),
    }))
    .filter((g) => g.docs.length > 0);
}

export function VentesDuJour() {
  const [data, setData] = useState<ApiResp | null>(null);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const today = useMemo(() => parisTodayISO(), []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      // Ventes SAISIES aujourd'hui (DocDate) — mode `entered` de l'API.
      const r = await fetch(`/api/livraisons?entered=${today}`, { cache: "no-store" });
      const j = await r.json().catch(() => null);
      if (j?.ok) setData(j); else toast.error(j?.error || "Ventes du jour indisponibles");
    } catch {
      toast.error("SAP injoignable — ventes du jour non chargées");
    } finally {
      setLoading(false);
    }
  }, [today]);

  useEffect(() => { load(); }, [load]);

  const needle = q.trim().toLowerCase();
  const groups = useMemo(() => {
    const base = toGroups(data);
    if (!needle) return base;
    return base
      .map((g) => ({ ...g, docs: g.docs.filter((d) =>
        d.cardName.toLowerCase().includes(needle) ||
        (d.cardFullName ?? "").toLowerCase().includes(needle) ||
        String(d.docNum).includes(needle)) }))
      .filter((g) => g.docs.length > 0);
  }, [data, needle]);

  const docs = useMemo(() => groups.flatMap((g) => g.docs), [groups]);
  const ca = docs.reduce((s, d) => s + d.totalHT, 0);
  const prepared = docs.filter((d) => d.prepared || d.departed).length;
  const departed = docs.filter((d) => d.departed).length;

  // ── 2ᵉ écran : par ARTICLE, ventilé GMS / CHR / EXPORT (uniquement ces 3) ──
  const [view, setView] = useState<View>("transporteur");
  const [metric, setMetric] = useState<Metric>("colis");
  // Tous les BL du jour (non exclus), indépendamment du filtre magasin.
  const allDocs = useMemo(
    () => (data?.ok ? data.carriers.flatMap((c) => c.docs).filter((d) => !d.excluded) : []),
    [data],
  );
  const articleRows = useMemo(() => {
    const map = new Map<string, ArticleAgg>();
    for (const d of allDocs) {
      const seg = d.clientType as Segment | null;
      if (!seg || !(SEGMENTS as readonly string[]).includes(seg)) continue; // uniquement les 3
      for (const l of d.lines) {
        let a = map.get(l.itemCode);
        if (!a) {
          a = { itemCode: l.itemCode, itemName: l.itemName, marque: l.marque ?? null, condt: l.condt ?? null,
            seg: { GMS: { colis: 0, kg: 0 }, CHR: { colis: 0, kg: 0 }, EXPORT: { colis: 0, kg: 0 } } };
          map.set(l.itemCode, a);
        }
        a.seg[seg].colis += l.colis || 0;
        a.seg[seg].kg += l.weightKg || 0;
      }
    }
    let rows = [...map.values()];
    if (needle) rows = rows.filter((a) => a.itemName.toLowerCase().includes(needle) || a.itemCode.toLowerCase().includes(needle));
    const tot = (a: ArticleAgg) => SEGMENTS.reduce((s, g) => s + a.seg[g][metric], 0);
    return rows.sort((x, y) => tot(y) - tot(x));
  }, [allDocs, needle, metric]);

  return (
    <div className="space-y-4">
      {/* Bandeau : synthèse + recherche + rafraîchissement */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={view === "article" ? "Filtrer par article…" : "Filtrer par magasin ou n° de BL…"}
            aria-label="Filtrer les ventes"
            className="h-11 w-full rounded-xl border border-border bg-card pl-9 pr-3 text-[13px] focus:outline-none focus:ring-2 focus:ring-ring/40"
          />
        </div>
        <button
          type="button"
          onClick={load}
          disabled={loading}
          className="inline-flex items-center gap-1.5 h-11 px-3 rounded-xl border border-border bg-card text-[12.5px] font-medium text-muted-foreground hover:text-foreground hover:bg-secondary/60 transition-colors disabled:opacity-60 shrink-0"
        >
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          <span className="hidden sm:inline">Actualiser</span>
        </button>
      </div>

      {/* Synthèse du jour */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <Stat label="Ventes saisies" value={docs.length.toString()} />
        <Stat label="CA HT" value={eur.format(ca)} />
        <Stat label="Préparées" value={`${prepared}/${docs.length}`} tone="emerald" />
        <Stat label="Parties" value={`${departed}/${docs.length}`} tone="sky" />
      </div>

      {/* Bascule d'écran : par transporteur (BL) ↔ par article (ventilé segments) */}
      <div className="inline-flex items-center gap-1 rounded-xl border border-border bg-card p-1">
        <ViewTab active={view === "transporteur"} onClick={() => setView("transporteur")} icon={<Truck className="h-4 w-4" />}>
          Par transporteur
        </ViewTab>
        <ViewTab active={view === "article"} onClick={() => setView("article")} icon={<Package className="h-4 w-4" />}>
          Par article
        </ViewTab>
      </div>

      {view === "transporteur" ? (
      <section className="rounded-2xl border border-border bg-card overflow-hidden">
        <div className="flex items-center gap-2.5 px-4 sm:px-5 py-3 border-b border-border bg-secondary/30">
          <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-brand-500/15 text-brand-600 dark:text-brand-400">
            <Store className="h-4 w-4" strokeWidth={2} />
          </span>
          <div className="min-w-0">
            <p className="text-[13.5px] font-semibold text-foreground leading-tight">
              Ventes saisies aujourd&apos;hui{data?.date ? ` — ${formatDeliveryDate(data.date)}` : ""}
            </p>
            <p className="text-[11px] text-muted-foreground">
              {loading && !data
                ? "Chargement…"
                : `${docs.length} vente${docs.length > 1 ? "s" : ""} · ${eur.format(ca)} HT · groupées par transporteur`}
            </p>
          </div>
        </div>

        {loading && !data ? (
          <div className="flex items-center gap-2 px-5 py-4 text-[13px] text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Chargement des ventes…
          </div>
        ) : groups.length === 0 ? (
          <p className="px-5 py-6 text-[13px] text-muted-foreground text-center">
            Aucune vente saisie aujourd&apos;hui{needle ? " pour cette recherche" : ""}.
          </p>
        ) : (
          groups.map((g) => (
            <div key={g.key}>
              <div className="flex items-center gap-2 px-4 sm:px-5 py-1.5 bg-secondary/20 border-y border-border/60">
                <Truck className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                <span className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground truncate">{g.name}</span>
                <span className="text-[11px] tnum text-muted-foreground/70">{g.docs.length}</span>
              </div>
              <ul className="divide-y divide-border/60">
                {g.docs.map((d) => <VenteRow key={d.docEntry} d={d} />)}
              </ul>
            </div>
          ))
        )}
      </section>
      ) : (
        <ArticleScreen rows={articleRows} metric={metric} onMetric={setMetric} loading={loading && !data} needle={needle} />
      )}
    </div>
  );
}

/* ── Onglet de bascule d'écran ─────────────────────────────────────────────── */
function ViewTab({ active, onClick, icon, children }: { active: boolean; onClick: () => void; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`inline-flex items-center gap-1.5 h-9 px-3 rounded-lg text-[12.5px] font-semibold transition-colors ${
        active ? "bg-brand-500/15 text-brand-700 dark:text-brand-300 ring-1 ring-brand-500/30" : "text-muted-foreground hover:text-foreground hover:bg-secondary/60"
      }`}
    >
      {icon}
      {children}
    </button>
  );
}

/* ── 2ᵉ écran : ventes du jour PAR ARTICLE, ventilées GMS / CHR / EXPORT ─────── */
const SEG_HEAD: Record<Segment, string> = {
  GMS: "text-teal-700 dark:text-teal-300",
  CHR: "text-amber-700 dark:text-amber-300",
  EXPORT: "text-violet-700 dark:text-violet-300",
};
function ArticleScreen({
  rows, metric, onMetric, loading, needle,
}: {
  rows: ArticleAgg[];
  metric: Metric;
  onMetric: (m: Metric) => void;
  loading: boolean;
  needle: string;
}) {
  const val = (q: SegQty) => (metric === "kg" ? q.kg : q.colis);
  const fmt = (n: number) =>
    n <= 0 ? <span className="text-muted-foreground/40">—</span>
    : metric === "kg"
      ? `${new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 }).format(n)}`
      : `${new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 1 }).format(n)}`;
  const rowTotal = (a: ArticleAgg) => SEGMENTS.reduce((s, g) => s + val(a.seg[g]), 0);
  // Totaux de colonne (par segment) + total général.
  const colTotals = { GMS: 0, CHR: 0, EXPORT: 0, all: 0 };
  for (const a of rows) for (const g of SEGMENTS) { colTotals[g] += val(a.seg[g]); colTotals.all += val(a.seg[g]); }
  const unit = metric === "kg" ? "kg" : "colis";

  return (
    <section className="rounded-2xl border border-border bg-card overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-2 px-4 sm:px-5 py-3 border-b border-border bg-secondary/30">
        <div className="flex items-center gap-2.5 min-w-0">
          <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-brand-500/15 text-brand-600 dark:text-brand-400">
            <Package className="h-4 w-4" strokeWidth={2} />
          </span>
          <div className="min-w-0">
            <p className="text-[13.5px] font-semibold text-foreground leading-tight">Ventes par article</p>
            <p className="text-[11px] text-muted-foreground">{rows.length} article{rows.length > 1 ? "s" : ""} · ventilés GMS / CHR / Export ({unit})</p>
          </div>
        </div>
        {/* Bascule métrique colis / kg */}
        <div className="inline-flex items-center gap-1 rounded-lg border border-border bg-card p-0.5 shrink-0">
          <MetricTab active={metric === "colis"} onClick={() => onMetric("colis")} icon={<Boxes className="h-3.5 w-3.5" />}>Colis</MetricTab>
          <MetricTab active={metric === "kg"} onClick={() => onMetric("kg")}>Kg</MetricTab>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 px-5 py-4 text-[13px] text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Chargement…
        </div>
      ) : rows.length === 0 ? (
        <p className="px-5 py-6 text-[13px] text-muted-foreground text-center">
          Aucune vente GMS / CHR / Export{needle ? " pour cette recherche" : " aujourd'hui"}.
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
                <tr key={a.itemCode} className="border-b border-border/40 last:border-0 hover:bg-secondary/30">
                  <td className="py-1.5 pl-4 sm:pl-5 pr-3">
                    <span className="text-foreground font-medium">{a.itemName}</span>
                    {(a.marque || a.condt) && (
                      <span className="ml-1.5 text-[10.5px] text-muted-foreground">{[a.marque, a.condt].filter(Boolean).join(" · ")}</span>
                    )}
                  </td>
                  {SEGMENTS.map((g) => (
                    <td key={g} className="py-1.5 px-3 text-right text-foreground/90">{fmt(val(a.seg[g]))}</td>
                  ))}
                  <td className="py-1.5 pl-3 pr-4 sm:pr-5 text-right font-bold text-foreground">{fmt(rowTotal(a))}</td>
                </tr>
              ))}
              {/* Totaux */}
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
  );
}

function MetricTab({ active, onClick, icon, children }: { active: boolean; onClick: () => void; icon?: React.ReactNode; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`inline-flex items-center gap-1 h-7 px-2.5 rounded-md text-[11.5px] font-semibold transition-colors ${
        active ? "bg-brand-500/15 text-brand-700 dark:text-brand-300" : "text-muted-foreground hover:text-foreground"
      }`}
    >
      {icon}
      {children}
    </button>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: "emerald" | "sky" }) {
  const color = tone === "emerald" ? "text-emerald-600 dark:text-emerald-400"
    : tone === "sky" ? "text-sky-600 dark:text-sky-400" : "text-foreground";
  return (
    <div className="rounded-xl border border-border bg-card px-3 py-2">
      <p className="text-[9.5px] uppercase tracking-wider text-muted-foreground font-semibold">{label}</p>
      <p className={`text-[18px] font-bold tnum leading-tight ${color}`}>{value}</p>
    </div>
  );
}

/** Coche d'avancement — verte/bleue cochée quand l'étape est atteinte, grise sinon. */
function Coche({ done, label, tone }: { done: boolean; label: string; tone: "emerald" | "sky" }) {
  const on = tone === "emerald"
    ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/40"
    : "bg-sky-500/15 text-sky-700 dark:text-sky-300 border-sky-500/40";
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-lg border px-2 h-7 text-[11px] font-semibold ${
        done ? on : "border-border text-muted-foreground/60"
      }`}
      title={done ? `${label} ✓` : `${label} — pas encore`}
    >
      <span className={`inline-flex h-4 w-4 items-center justify-center rounded ${
        done ? (tone === "emerald" ? "bg-emerald-500 text-white" : "bg-sky-500 text-white") : "border border-border"
      }`}>
        {done && <Check className="h-3 w-3" strokeWidth={3} />}
      </span>
      {label}
    </span>
  );
}

/** Ligne de vente — un BL (magasin), consultation ; coches préparé + départ. */
function VenteRow({ d }: { d: Doc }) {
  const takenTime = d.takenAt ? d.takenAt.slice(11, 16) : null;
  return (
    <li className="flex flex-col sm:flex-row sm:items-center gap-2 px-4 sm:px-5 py-2.5">
      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-2 min-w-0 text-[13.5px] font-semibold text-foreground">
          <Store className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          <span className="truncate">{d.cardFullName ?? d.cardName}</span>
          {d.clientType && SEGMENT_BADGE[d.clientType] && (
            <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[9.5px] font-bold uppercase tracking-wide shrink-0 ${SEGMENT_BADGE[d.clientType]}`}>
              {d.clientType}
            </span>
          )}
        </p>
        <p className="text-[11px] text-muted-foreground flex items-center gap-x-2 gap-y-0.5 flex-wrap">
          <span>BL # {d.docNum}</span>
          {takenTime && <span className="inline-flex items-center gap-1"><Clock className="h-3 w-3" /> Prise {takenTime}</span>}
          <span className="inline-flex items-center gap-1"><CalendarDays className="h-3 w-3" /> Livr. {shortDate(d.dueDate)}</span>
          <span>{d.colis.toLocaleString("fr-FR")} colis</span>
          {d.totalHT > 0 && <span>{eur.format(d.totalHT)} HT</span>}
        </p>
      </div>
      {/* Avancement : coches Préparé (fait) puis Départ (parti). */}
      <div className="flex items-center gap-1.5 shrink-0">
        <Coche done={d.prepared || !!d.departed} label="Préparé" tone="emerald" />
        <Coche done={!!d.departed} label="Départ" tone="sky" />
      </div>
    </li>
  );
}
