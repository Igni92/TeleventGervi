"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Truck, Boxes, Scale, Users, FileText, Receipt,
  ChevronLeft, ChevronRight, ChevronDown, CalendarDays, AlertTriangle,
  RefreshCw, Loader2, PackageX, CheckCircle2, Clock, RotateCcw,
} from "lucide-react";
import { ClientLink } from "@/components/ClientLink";
import {
  nextDeliveryDate, frenchHolidayLabel, nextWorkingDeliveryDay,
  formatDeliveryDate, addDaysISO,
} from "@/lib/livraison";

/* ─────────────────────────────────────────────────────────────
   Types (miroir de /api/livraisons)
───────────────────────────────────────────────────────────── */
interface Line {
  itemCode: string;
  itemName: string;
  quantity: number;
  colis: number;
  weightKg: number;
  warehouse: string | null;
}
interface Doc {
  docEntry: number;
  docNum: number;
  docDate: string;
  dueDate: string;
  cardCode: string;
  cardName: string;
  totalHT: number;
  totalTTC: number;
  colis: number;
  weightKg: number;
  open: boolean;
  comments: string;
  numAtCard: string;
  trspCode: string | null;
  carrierName: string | null;
  lineCount: number;
  lines: Line[];
}
interface Carrier {
  code: string | null;
  name: string;
  orders: number;
  colis: number;
  weightKg: number;
  totalHT: number;
  docs: Doc[];
}
interface Totals {
  orders: number;
  clients: number;
  colis: number;
  weightKg: number;
  totalHT: number;
}
interface ApiResp {
  ok: boolean;
  db?: string;
  date: string;
  holiday: string | null;
  count: number;
  totals: Totals;
  carriers: Carrier[];
  error?: string;
}

/* ─────────────────────────────────────────────────────────────
   Formatters
───────────────────────────────────────────────────────────── */
const fmtInt = (v: number) => new Intl.NumberFormat("fr-FR").format(Math.round(v));
const fmtNum = (v: number) =>
  new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 1 }).format(v);
const fmtKg = (v: number) => `${fmtNum(v)} kg`;
const fmtEur = (v: number) =>
  new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(v);
const capitalize = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

/* ═════════════════════════════════════════════════════════════
   Composant principal
═════════════════════════════════════════════════════════════ */
export function LivraisonDetail() {
  const [date, setDate] = useState<string>(() => nextDeliveryDate());
  const [data, setData] = useState<ApiResp | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const auto = useMemo(() => nextDeliveryDate(), []);
  const holiday = frenchHolidayLabel(date);
  const isAuto = date === auto;

  const load = useCallback(
    (signal?: AbortSignal) => {
      setLoading(true);
      setError(null);
      fetch(`/api/livraisons?date=${date}`, { cache: "no-store", signal })
        .then(async (r) => {
          const j: ApiResp = await r.json();
          if (signal?.aborted) return;
          if (!j.ok) {
            setError(j.error || "Erreur de chargement.");
            setData(null);
          } else {
            setData(j);
          }
        })
        .catch((e) => {
          if (e?.name !== "AbortError") setError("SAP injoignable. Réessayez.");
        })
        .finally(() => {
          if (!signal?.aborted) setLoading(false);
        });
    },
    [date],
  );

  useEffect(() => {
    const ctrl = new AbortController();
    load(ctrl.signal);
    return () => ctrl.abort();
  }, [load]);

  const shift = (days: number) => setDate((d) => addDaysISO(d, days));

  return (
    <div className="space-y-5 animate-fade-up">
      {/* ── En-tête ── */}
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="kicker mb-1.5">Télévente · logistique</p>
          <h1 className="font-display text-[28px] sm:text-[34px] font-semibold text-foreground tracking-tight leading-none">
            Détail livraison
          </h1>
          <p className="hidden md:block text-[12.5px] text-muted-foreground mt-2 max-w-2xl">
            Toutes les commandes à préparer pour la prochaine tournée
            (<b>J+1</b>, sauf le samedi → <b>J+2</b>). En cas de jour férié, ajustez la
            date de livraison ci-dessous.
          </p>
        </div>
        <button
          type="button"
          onClick={() => load()}
          disabled={loading}
          className="inline-flex items-center gap-1.5 h-9 px-3 rounded-lg border border-border bg-card text-[12.5px] font-medium text-muted-foreground hover:text-foreground hover:bg-secondary/60 transition-colors disabled:opacity-60 shrink-0"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
          Actualiser
        </button>
      </header>

      {/* ── Sélecteur de jour de livraison (pièce maîtresse) ── */}
      <DatePanel
        date={date}
        isAuto={isAuto}
        holiday={holiday}
        onShift={shift}
        onPick={setDate}
        onReset={() => setDate(auto)}
        onReport={() => setDate(nextWorkingDeliveryDay(date))}
      />

      {/* ── Bandeau de synthèse ── */}
      {data?.totals && <SummaryRow totals={data.totals} loading={loading} />}

      {/* ── Contenu ── */}
      {error ? (
        <div className="flex items-center gap-3 rounded-xl border border-rose-300/60 dark:border-rose-500/30 bg-rose-50 dark:bg-rose-900/15 px-5 py-4">
          <AlertTriangle className="h-5 w-5 text-rose-500 shrink-0" />
          <div>
            <p className="text-[13px] font-medium text-rose-700 dark:text-rose-300">{error}</p>
            <button onClick={() => load()} className="text-[12px] text-rose-600 dark:text-rose-400 hover:underline mt-0.5">
              Réessayer
            </button>
          </div>
        </div>
      ) : loading && !data ? (
        <LoadingState />
      ) : data && data.count === 0 ? (
        <EmptyState date={date} />
      ) : data ? (
        <div className={`space-y-4 transition-opacity ${loading ? "opacity-60" : ""}`}>
          {data.carriers.map((c) => (
            <CarrierGroup key={c.code ?? "__none__"} carrier={c} />
          ))}
        </div>
      ) : null}
    </div>
  );
}

/* ═════════════════════════════════════════════════════════════
   Sélecteur de date — grand, lisible, avec garde-fou jour férié
═════════════════════════════════════════════════════════════ */
function DatePanel({
  date, isAuto, holiday, onShift, onPick, onReset, onReport,
}: {
  date: string;
  isAuto: boolean;
  holiday: string | null;
  onShift: (days: number) => void;
  onPick: (iso: string) => void;
  onReset: () => void;
  onReport: () => void;
}) {
  return (
    <section className="rounded-2xl border border-border bg-card overflow-hidden">
      <div className="flex flex-col sm:flex-row sm:items-center gap-4 p-4 sm:p-5">
        {/* Identité du jour livré */}
        <div className="flex items-center gap-3.5 min-w-0 flex-1">
          <span className="hidden sm:inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-brand-500/20 to-brand-500/5 text-brand-600 dark:text-brand-400">
            <Truck className="h-6 w-6" strokeWidth={1.9} />
          </span>
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-[10px] uppercase tracking-[0.14em] font-semibold text-muted-foreground">
                Livraison du
              </span>
              {isAuto ? (
                <span className="inline-flex items-center gap-1 rounded-full bg-brand-500/12 text-brand-600 dark:text-brand-400 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide">
                  <Clock className="h-3 w-3" /> Prochaine
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/15 text-amber-600 dark:text-amber-400 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide">
                  Date choisie
                </span>
              )}
            </div>
            <p className="text-[20px] sm:text-[23px] font-semibold tracking-tight text-foreground leading-tight mt-0.5 truncate">
              {capitalize(formatDeliveryDate(date))}
            </p>
          </div>
        </div>

        {/* Contrôles */}
        <div className="flex items-center gap-1.5 shrink-0">
          <button
            type="button" onClick={() => onShift(-1)} aria-label="Jour précédent"
            className="h-11 w-11 inline-flex items-center justify-center rounded-xl border border-border text-muted-foreground hover:text-foreground hover:bg-secondary/60 active:scale-95 transition-colors"
          >
            <ChevronLeft className="h-5 w-5" />
          </button>
          <label className="relative inline-flex items-center">
            <CalendarDays className="pointer-events-none absolute left-3 h-4 w-4 text-muted-foreground" />
            <input
              type="date"
              value={date}
              onChange={(e) => e.target.value && onPick(e.target.value)}
              className="h-11 rounded-xl border border-border bg-background pl-9 pr-3 text-[13.5px] font-medium text-foreground tnum focus:outline-none focus:ring-2 focus:ring-brand-500/40"
            />
          </label>
          <button
            type="button" onClick={() => onShift(1)} aria-label="Jour suivant"
            className="h-11 w-11 inline-flex items-center justify-center rounded-xl border border-border text-muted-foreground hover:text-foreground hover:bg-secondary/60 active:scale-95 transition-colors"
          >
            <ChevronRight className="h-5 w-5" />
          </button>
          {!isAuto && (
            <button
              type="button" onClick={onReset} title="Revenir à la prochaine livraison"
              className="h-11 w-11 inline-flex items-center justify-center rounded-xl border border-border text-muted-foreground hover:text-brand-600 dark:hover:text-brand-400 hover:bg-secondary/60 active:scale-95 transition-colors"
            >
              <RotateCcw className="h-[18px] w-[18px]" />
            </button>
          )}
        </div>
      </div>

      {/* Garde-fou jour férié */}
      {holiday && (
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 border-t border-amber-300/50 dark:border-amber-500/25 bg-amber-50 dark:bg-amber-900/15 px-4 sm:px-5 py-3">
          <p className="inline-flex items-center gap-2 text-[12.5px] font-medium text-amber-800 dark:text-amber-300">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            <span>
              <b>{holiday}</b> — jour férié, pas de livraison. Choisissez le jour de livraison réel.
            </span>
          </p>
          <button
            type="button"
            onClick={onReport}
            className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg bg-amber-500 text-white text-[12px] font-semibold hover:bg-amber-600 active:scale-95 transition-colors shrink-0 self-start sm:self-auto"
          >
            <ChevronRight className="h-3.5 w-3.5" />
            Reporter au prochain jour ouvré
          </button>
        </div>
      )}
    </section>
  );
}

/* ═════════════════════════════════════════════════════════════
   Bandeau de synthèse — chiffres clés de la tournée
═════════════════════════════════════════════════════════════ */
function SummaryRow({ totals, loading }: { totals: Totals; loading: boolean }) {
  const stats = [
    { icon: FileText, label: "Commandes", value: fmtInt(totals.orders), accent: "text-brand-600 dark:text-brand-400" },
    { icon: Users, label: "Clients", value: fmtInt(totals.clients), accent: "text-sky-600 dark:text-sky-400" },
    { icon: Boxes, label: "Colis", value: fmtNum(totals.colis), accent: "text-violet-600 dark:text-violet-400", hero: true },
    { icon: Scale, label: "Poids net", value: fmtKg(totals.weightKg), accent: "text-emerald-600 dark:text-emerald-400" },
    { icon: Receipt, label: "Total HT", value: fmtEur(totals.totalHT), accent: "text-amber-600 dark:text-amber-400" },
  ];
  return (
    <div className={`grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2.5 transition-opacity ${loading ? "opacity-60" : ""}`}>
      {stats.map((s) => {
        const Icon = s.icon;
        return (
          <div
            key={s.label}
            className={`rounded-xl border border-border bg-card p-3.5 ${s.hero ? "ring-1 ring-violet-500/20" : ""}`}
          >
            <div className="flex items-center gap-1.5 mb-1.5">
              <Icon className={`h-3.5 w-3.5 ${s.accent}`} strokeWidth={2} />
              <span className="text-[9.5px] uppercase tracking-[0.12em] font-semibold text-muted-foreground">
                {s.label}
              </span>
            </div>
            <p className="text-[22px] font-bold tnum text-foreground leading-none">{s.value}</p>
          </div>
        );
      })}
    </div>
  );
}

/* ═════════════════════════════════════════════════════════════
   Groupe transporteur — en-tête + cartes clients
═════════════════════════════════════════════════════════════ */
function CarrierGroup({ carrier }: { carrier: Carrier }) {
  const unassigned = !carrier.code;
  return (
    <section className="rounded-2xl border border-border bg-card overflow-hidden">
      {/* En-tête transporteur */}
      <div className="flex items-center justify-between gap-3 px-4 sm:px-5 py-3 border-b border-border bg-secondary/30">
        <div className="flex items-center gap-2.5 min-w-0">
          <span
            className={`inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${
              unassigned
                ? "bg-muted text-muted-foreground"
                : "bg-brand-500/12 text-brand-600 dark:text-brand-400"
            }`}
          >
            <Truck className="h-4 w-4" strokeWidth={2} />
          </span>
          <div className="min-w-0">
            <p className="text-[10px] uppercase tracking-[0.12em] font-semibold text-muted-foreground leading-none">
              Transporteur
            </p>
            <p className={`text-[15px] font-semibold leading-tight mt-0.5 truncate ${unassigned ? "text-muted-foreground italic" : "text-foreground"}`}>
              {carrier.name}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3 sm:gap-4 shrink-0 text-right">
          <Metric label="Cmd." value={fmtInt(carrier.orders)} />
          <Metric label="Colis" value={fmtNum(carrier.colis)} strong />
          <Metric label="kg" value={fmtNum(carrier.weightKg)} className="hidden sm:block" />
        </div>
      </div>

      {/* Cartes clients */}
      <ul className="divide-y divide-border/60">
        {carrier.docs.map((d) => (
          <OrderRow key={d.docEntry} doc={d} />
        ))}
      </ul>
    </section>
  );
}

function Metric({ label, value, strong, className }: { label: string; value: string; strong?: boolean; className?: string }) {
  return (
    <div className={className}>
      <p className={`tnum leading-none ${strong ? "text-[17px] font-bold text-foreground" : "text-[14px] font-semibold text-foreground/85"}`}>
        {value}
      </p>
      <p className="text-[9px] uppercase tracking-wider text-muted-foreground mt-0.5">{label}</p>
    </div>
  );
}

/* ═════════════════════════════════════════════════════════════
   Ligne commande — repliable vers le détail des lignes
═════════════════════════════════════════════════════════════ */
function OrderRow({ doc }: { doc: Doc }) {
  const [open, setOpen] = useState(false);
  return (
    <li>
      <div className="flex items-center gap-3 px-4 sm:px-5 py-3 hover:bg-secondary/25 transition-colors">
        {/* Identité client */}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <ClientLink
              code={doc.cardCode}
              name={doc.cardName}
              className="text-[14.5px] font-semibold text-foreground truncate text-left hover:underline decoration-brand-500/60 underline-offset-2 max-w-full"
            />
            {!doc.open && (
              <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/12 text-emerald-600 dark:text-emerald-400 px-1.5 py-0.5 text-[9.5px] font-bold uppercase tracking-wide">
                <CheckCircle2 className="h-2.5 w-2.5" /> Livrée
              </span>
            )}
          </div>
          <div className="flex items-center gap-2 mt-0.5 text-[11px] text-muted-foreground flex-wrap">
            <span className="font-mono text-foreground/60">{doc.cardCode}</span>
            <span>· BL n°{doc.docNum}</span>
            {doc.numAtCard && <span className="truncate">· réf. {doc.numAtCard}</span>}
            <span className="hidden sm:inline">· {fmtEur(doc.totalHT)} HT</span>
          </div>
        </div>

        {/* Colis / poids — repère logistique */}
        <div className="flex items-center gap-3 sm:gap-5 shrink-0">
          <div className="text-right">
            <p className="text-[18px] font-bold tnum text-foreground leading-none">{fmtNum(doc.colis)}</p>
            <p className="text-[9px] uppercase tracking-wider text-muted-foreground mt-0.5">colis</p>
          </div>
          <div className="text-right min-w-[44px]">
            <p className="text-[14px] font-semibold tnum text-foreground/85 leading-none">{fmtNum(doc.weightKg)}</p>
            <p className="text-[9px] uppercase tracking-wider text-muted-foreground mt-0.5">kg</p>
          </div>
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            aria-label={open ? "Replier le détail" : "Voir le détail"}
            aria-expanded={open}
            className="h-9 w-9 inline-flex items-center justify-center rounded-lg border border-border text-muted-foreground hover:text-foreground hover:bg-secondary/60 active:scale-95 transition-all"
          >
            <ChevronDown className={`h-4 w-4 transition-transform duration-200 ${open ? "rotate-180" : ""}`} />
          </button>
        </div>
      </div>

      {/* Détail des lignes */}
      {open && (
        <div className="px-4 sm:px-5 pb-3.5 pt-0.5">
          <div className="rounded-xl border border-border/70 bg-secondary/20 overflow-hidden">
            {doc.comments && (
              <p className="px-3 py-2 text-[11.5px] text-muted-foreground border-b border-border/60 italic">
                {doc.comments}
              </p>
            )}
            <table className="w-full text-[12px]">
              <thead className="text-[9px] uppercase tracking-wider text-muted-foreground bg-card/40">
                <tr>
                  <th className="text-left font-semibold px-3 py-1.5">Article</th>
                  <th className="text-right font-semibold px-3 py-1.5 whitespace-nowrap">Colis</th>
                  <th className="text-right font-semibold px-3 py-1.5 whitespace-nowrap hidden sm:table-cell">Qté</th>
                  <th className="text-right font-semibold px-3 py-1.5 whitespace-nowrap">kg</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/40">
                {doc.lines.map((l, i) => (
                  <tr key={`${l.itemCode}-${i}`}>
                    <td className="px-3 py-1.5 min-w-0">
                      <span className="font-medium text-foreground/90">{l.itemName}</span>
                      <span className="ml-1.5 font-mono text-[10px] text-muted-foreground/70">{l.itemCode}</span>
                    </td>
                    <td className="px-3 py-1.5 text-right tnum font-semibold text-foreground">{fmtNum(l.colis)}</td>
                    <td className="px-3 py-1.5 text-right tnum text-muted-foreground hidden sm:table-cell">{fmtNum(l.quantity)}</td>
                    <td className="px-3 py-1.5 text-right tnum text-muted-foreground">{fmtNum(l.weightKg)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </li>
  );
}

/* ═════════════════════════════════════════════════════════════
   États vides / chargement
═════════════════════════════════════════════════════════════ */
function EmptyState({ date }: { date: string }) {
  return (
    <div className="flex flex-col items-center justify-center text-center rounded-2xl border border-dashed border-border bg-card py-16 px-6">
      <span className="inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-secondary/60 text-muted-foreground mb-3">
        <PackageX className="h-7 w-7" strokeWidth={1.7} />
      </span>
      <p className="text-[15px] font-semibold text-foreground">Aucune commande à livrer</p>
      <p className="text-[12.5px] text-muted-foreground mt-1 max-w-xs">
        Rien n&apos;est planifié pour le {formatDeliveryDate(date)}. Changez de date
        ou actualisez si une commande vient d&apos;être saisie.
      </p>
    </div>
  );
}

function LoadingState() {
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 text-[12.5px] text-muted-foreground px-1">
        <Loader2 className="h-4 w-4 animate-spin" /> Chargement des commandes…
      </div>
      {[0, 1].map((i) => (
        <div key={i} className="rounded-2xl border border-border bg-card overflow-hidden animate-pulse">
          <div className="h-14 border-b border-border bg-secondary/30" />
          <div className="divide-y divide-border/60">
            {[0, 1, 2].map((j) => (
              <div key={j} className="h-16 px-5 flex items-center">
                <div className="h-4 w-40 rounded bg-secondary/60" />
                <div className="ml-auto h-6 w-10 rounded bg-secondary/60" />
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
