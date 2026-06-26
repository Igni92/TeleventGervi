"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Truck, Boxes, Scale, Users, FileText, Receipt,
  ChevronLeft, ChevronRight, ChevronDown, CalendarDays, AlertTriangle,
  RefreshCw, Loader2, PackageX, CheckCircle2, Clock, RotateCcw, Pencil,
} from "lucide-react";
import { toast } from "sonner";
import { ClientLink } from "@/components/ClientLink";
import { broadcastActiveClient } from "@/lib/consoleSync";
import {
  nextDeliveryDate, frenchHolidayLabel, nextWorkingDeliveryDay,
  formatDeliveryDate, addDaysISO,
} from "@/lib/livraison";

interface CarrierOption { name: string; sapValue: string }
interface Tournee { lineId: number; nom: string; des: string; heure: string | null }

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
  trspHeure: string | null;
  carrierName: string | null;
  clientType: string | null;   // GMS | CHR | EXPORT | null
  prepared: boolean;           // « faite » — coché manuellement
  excluded: boolean;           // « avoir / exclu » — déduit 100% des totaux
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

/* ─────────────────────────────────────────────────────────────
   Segment client (GMS / CHR / EXPORT) — filtre + différenciation
───────────────────────────────────────────────────────────── */
type Segment = "ALL" | "GMS" | "CHR" | "EXPORT" | "AUTRES";

/** Une commande appartient-elle au segment filtré ? (AUTRES = type absent) */
function matchSegment(d: { clientType: string | null }, seg: Segment): boolean {
  if (seg === "ALL") return true;
  if (seg === "AUTRES") return d.clientType !== "GMS" && d.clientType !== "CHR" && d.clientType !== "EXPORT";
  return d.clientType === seg;
}

/** Styles par segment : pastille de filtre (active/inactive) + badge de ligne. */
const SEG_UI: Record<Exclude<Segment, "ALL">, { label: string; active: string; badge: string }> = {
  GMS:    { label: "GMS",    active: "bg-blue-600 text-white border-blue-600",       badge: "bg-blue-100 text-blue-700 dark:bg-blue-950/60 dark:text-blue-300" },
  CHR:    { label: "CHR",    active: "bg-amber-500 text-white border-amber-500",     badge: "bg-amber-100 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300" },
  EXPORT: { label: "Export", active: "bg-violet-600 text-white border-violet-600",   badge: "bg-violet-100 text-violet-700 dark:bg-violet-950/60 dark:text-violet-300" },
  AUTRES: { label: "Autres", active: "bg-foreground text-background border-foreground", badge: "bg-muted text-muted-foreground" },
};

/* ═════════════════════════════════════════════════════════════
   Composant principal
═════════════════════════════════════════════════════════════ */
export function LivraisonDetail() {
  const [date, setDate] = useState<string>(() => nextDeliveryDate());
  const [data, setData] = useState<ApiResp | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [carriers, setCarriers] = useState<CarrierOption[]>([]);
  // Tournées par transporteur (SERGTRS), chargées à la demande quand on ouvre le
  // sélecteur de tournée d'une commande. Cache mémoire + dédup des fetchs.
  const [tourneesByCode, setTourneesByCode] = useState<Record<string, Tournee[]>>({});
  const tourneesLoading = useRef<Set<string>>(new Set());

  // Catalogue des transporteurs (SERGTRS) pour le changement direct par commande.
  useEffect(() => {
    let cancelled = false;
    fetch("/api/transporteurs")
      .then((r) => r.json())
      .then((j) => {
        if (cancelled || !j?.ok) return;
        const opts: CarrierOption[] = (j.transporteurs ?? [])
          .filter((t: { code?: string | null }) => t.code)
          .map((t: { name: string; code: string }) => ({ name: t.name, sapValue: t.code }));
        setCarriers(opts);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  // Charge (une fois) les tournées d'un transporteur pour peupler le sélecteur.
  const loadTournees = useCallback(async (code: string) => {
    const key = code.trim().toUpperCase();
    if (!key || tourneesByCode[key] || tourneesLoading.current.has(key)) return;
    tourneesLoading.current.add(key);
    try {
      const r = await fetch(`/api/transporteurs?code=${encodeURIComponent(code)}`);
      const j = await r.json().catch(() => null);
      if (j?.ok && j.transporteur) {
        setTourneesByCode((prev) => ({ ...prev, [key]: j.transporteur.tournees ?? [] }));
      }
    } catch { /* ignore */ } finally {
      tourneesLoading.current.delete(key);
    }
  }, [tourneesByCode]);

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

  // Changement de transporteur d'une commande (écrit ORDR.U_TrspCode dans SAP),
  // puis rechargement pour re-grouper. "" = désaffecter.
  const changeCarrier = useCallback(
    async (docEntry: number, sapValue: string): Promise<boolean> => {
      try {
        // Changer de transporteur réinitialise la tournée (heure) : elle dépend du
        // transporteur. On envoie trspHeure:"" → le serveur vide U_TrspHeur et
        // re-résout U_Timbre pour le nouveau transporteur.
        const res = await fetch(`/api/sap/orders/${docEntry}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ trspCode: sapValue, trspHeure: "" }),
        });
        const j = await res.json().catch(() => null);
        if (!res.ok || !j?.ok) {
          toast.error(j?.error ? `Échec : ${j.error}` : "Échec du changement de transporteur");
          return false;
        }
        toast.success(sapValue ? "Transporteur mis à jour — choisis la tournée" : "Transporteur retiré");
        load();
        return true;
      } catch {
        toast.error("SAP injoignable — transporteur non modifié");
        return false;
      }
    },
    [load],
  );

  // Changement de TOURNÉE d'une commande → pose U_TrspHeur (heure de la tournée)
  // et re-confirme le transporteur (le serveur re-résout U_Timbre). "" = aucune.
  const changeTournee = useCallback(
    async (docEntry: number, trspCode: string, heure: string): Promise<boolean> => {
      try {
        const res = await fetch(`/api/sap/orders/${docEntry}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ trspCode, trspHeure: heure }),
        });
        const j = await res.json().catch(() => null);
        if (!res.ok || !j?.ok) {
          toast.error(j?.error ? `Échec : ${j.error}` : "Échec du changement de tournée");
          return false;
        }
        toast.success(heure ? `Tournée mise à jour (${heure.slice(0, 5)})` : "Tournée retirée");
        load();
        return true;
      } catch {
        toast.error("SAP injoignable — tournée non modifiée");
        return false;
      }
    },
    [load],
  );

  // Changement de DATE DE LIVRAISON d'une commande (écrit ORDR.DocDueDate), puis
  // rechargement (la commande quitte la vue si elle change de jour).
  const changeDate = useCallback(
    async (docEntry: number, dueDate: string): Promise<boolean> => {
      try {
        const res = await fetch(`/api/sap/orders/${docEntry}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ dueDate }),
        });
        const j = await res.json().catch(() => null);
        if (!res.ok || !j?.ok) {
          toast.error(j?.error ? `Échec : ${j.error}` : "Échec du changement de date");
          return false;
        }
        toast.success(`Livraison déplacée au ${formatDeliveryDate(dueDate)}`);
        load();
        return true;
      } catch {
        toast.error("SAP injoignable — date non modifiée");
        return false;
      }
    },
    [load],
  );

  // ── Filtre par segment client (GMS / CHR / EXPORT) ──
  const [segment, setSegment] = useState<Segment>("ALL");
  // ── Repliage des groupes transporteur (clé = code transporteur) ──
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const toggleCollapse = useCallback((key: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }, []);

  // Comptes par segment (sur l'ensemble, pour les pastilles du filtre).
  const segCounts = useMemo(() => {
    const c: Record<Segment, number> = { ALL: 0, GMS: 0, CHR: 0, EXPORT: 0, AUTRES: 0 };
    if (!data) return c;
    for (const car of data.carriers) for (const d of car.docs) {
      c.ALL++;
      if (d.clientType === "GMS") c.GMS++;
      else if (d.clientType === "CHR") c.CHR++;
      else if (d.clientType === "EXPORT") c.EXPORT++;
      else c.AUTRES++;
    }
    return c;
  }, [data]);

  // Vue filtrée : on recoupe les commandes par segment et on recalcule les
  // métriques (groupes + bandeau de synthèse) pour rester cohérent.
  const view = useMemo(() => {
    if (!data) return null;
    if (segment === "ALL") return data;
    const r1 = (n: number) => Math.round(n * 10) / 10;
    const r2 = (n: number) => Math.round(n * 100) / 100;
    const carriers = data.carriers
      .map((c) => {
        const docs = c.docs.filter((d) => matchSegment(d, segment));
        return {
          ...c, docs,
          orders: docs.length,
          colis: r1(docs.reduce((s, d) => s + d.colis, 0)),
          weightKg: r1(docs.reduce((s, d) => s + d.weightKg, 0)),
          totalHT: r2(docs.reduce((s, d) => s + d.totalHT, 0)),
        };
      })
      .filter((c) => c.docs.length > 0);
    const allDocs = carriers.flatMap((c) => c.docs);
    const totals: Totals = {
      orders: allDocs.length,
      clients: new Set(allDocs.map((d) => d.cardCode)).size,
      colis: r1(allDocs.reduce((s, d) => s + d.colis, 0)),
      weightKg: r1(allDocs.reduce((s, d) => s + d.weightKg, 0)),
      totalHT: r2(allDocs.reduce((s, d) => s + d.totalHT, 0)),
    };
    return { ...data, carriers, totals, count: allDocs.length };
  }, [data, segment]);

  const allKeys = useMemo(() => (view?.carriers ?? []).map((c) => c.code ?? "__none__"), [view]);
  const allCollapsed = allKeys.length > 0 && allKeys.every((k) => collapsed.has(k));
  const toggleAll = () => setCollapsed(allCollapsed ? new Set() : new Set(allKeys));

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

      {/* ── Bandeau de synthèse (reflète le filtre segment) ── */}
      {view?.totals && <SummaryRow totals={view.totals} loading={loading} />}

      {/* ── Filtre segment + repliage global ── */}
      {data && data.count > 0 && (
        <SegmentFilter
          segment={segment}
          counts={segCounts}
          onPick={setSegment}
          allCollapsed={allCollapsed}
          onToggleAll={toggleAll}
        />
      )}

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
      ) : view && view.count === 0 ? (
        <div className="flex flex-col items-center justify-center text-center rounded-2xl border border-dashed border-border bg-card py-12 px-6">
          <p className="text-[14px] font-semibold text-foreground">Aucune commande pour ce segment</p>
          <p className="text-[12.5px] text-muted-foreground mt-1">
            Aucune livraison « {segment === "AUTRES" ? "Autres" : segment} » ce jour-là.
            <button onClick={() => setSegment("ALL")} className="ml-1 text-brand-600 dark:text-brand-400 hover:underline">Voir tout</button>
          </p>
        </div>
      ) : view ? (
        <div className={`space-y-4 transition-opacity ${loading ? "opacity-60" : ""}`}>
          {view.carriers.map((c) => {
            const key = c.code ?? "__none__";
            return (
              <CarrierGroup
                key={key} carrier={c} carriers={carriers} onCarrierChange={changeCarrier} onDateChange={changeDate}
                tourneesByCode={tourneesByCode} onLoadTournees={loadTournees} onTourneeChange={changeTournee}
                collapsed={collapsed.has(key)} onToggleCollapse={() => toggleCollapse(key)}
              />
            );
          })}
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
function CarrierGroup({
  carrier, carriers, onCarrierChange, onDateChange,
  tourneesByCode, onLoadTournees, onTourneeChange,
  collapsed, onToggleCollapse,
}: {
  carrier: Carrier;
  carriers: CarrierOption[];
  onCarrierChange: (docEntry: number, sapValue: string) => Promise<boolean>;
  onDateChange: (docEntry: number, dueDate: string) => Promise<boolean>;
  tourneesByCode: Record<string, Tournee[]>;
  onLoadTournees: (code: string) => void;
  onTourneeChange: (docEntry: number, trspCode: string, heure: string) => Promise<boolean>;
  collapsed: boolean;
  onToggleCollapse: () => void;
}) {
  const unassigned = !carrier.code;
  return (
    <section className="rounded-2xl border border-border bg-card overflow-hidden">
      {/* En-tête transporteur — cliquable pour replier/déplier le groupe */}
      <div
        role="button" tabIndex={0}
        onClick={onToggleCollapse}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onToggleCollapse(); } }}
        aria-expanded={!collapsed}
        title={collapsed ? "Déplier ce transporteur" : "Replier ce transporteur"}
        className="flex items-center justify-between gap-3 px-4 sm:px-5 py-3 border-b border-border bg-secondary/30 hover:bg-secondary/50 cursor-pointer select-none transition-colors"
      >
        <div className="flex items-center gap-2.5 min-w-0">
          <ChevronDown className={`h-4 w-4 text-muted-foreground shrink-0 transition-transform duration-200 ${collapsed ? "-rotate-90" : ""}`} />
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
        <div className="flex items-center gap-6 sm:gap-8 shrink-0 text-right">
          <Metric label="Cmd." value={fmtInt(carrier.orders)} />
          <Metric label="Colis" value={fmtNum(carrier.colis)} />
          <Metric label="kg" value={fmtNum(carrier.weightKg)} className="hidden sm:block" />
        </div>
      </div>

      {/* Cartes clients (masquées si le groupe est replié) */}
      {!collapsed && (
        <ul className="divide-y divide-border/60">
          {carrier.docs.map((d) => (
            <OrderRow
              key={d.docEntry} doc={d} carriers={carriers}
              onCarrierChange={onCarrierChange} onDateChange={onDateChange}
              tournees={d.trspCode ? tourneesByCode[d.trspCode.toUpperCase()] : undefined}
              onLoadTournees={onLoadTournees} onTourneeChange={onTourneeChange}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

/* ═════════════════════════════════════════════════════════════
   Filtre par segment client (GMS / CHR / EXPORT) + repliage global
═════════════════════════════════════════════════════════════ */
function SegmentFilter({
  segment, counts, onPick, allCollapsed, onToggleAll,
}: {
  segment: Segment;
  counts: Record<Segment, number>;
  onPick: (s: Segment) => void;
  allCollapsed: boolean;
  onToggleAll: () => void;
}) {
  // ALL toujours présent ; un segment n'apparaît que s'il a au moins 1 commande.
  const segs: Segment[] = ["ALL", "GMS", "CHR", "EXPORT", "AUTRES"];
  return (
    <div className="flex items-center justify-between gap-3 flex-wrap">
      <div className="flex items-center gap-1.5 flex-wrap">
        {segs.map((s) => {
          if (s !== "ALL" && counts[s] === 0) return null;
          const isActive = segment === s;
          const label = s === "ALL" ? "Tous" : SEG_UI[s as Exclude<Segment, "ALL">].label;
          const activeCls = s === "ALL"
            ? "bg-foreground text-background border-foreground"
            : SEG_UI[s as Exclude<Segment, "ALL">].active;
          return (
            <button
              key={s}
              type="button"
              onClick={() => onPick(s)}
              aria-pressed={isActive}
              className={`inline-flex items-center gap-1.5 h-8 px-3 rounded-lg border text-[12.5px] font-semibold transition-colors ${
                isActive ? activeCls : "border-border bg-card text-muted-foreground hover:text-foreground hover:bg-secondary/60"
              }`}
            >
              {label}
              <span className={`tnum text-[11px] font-bold ${isActive ? "opacity-90" : "opacity-60"}`}>
                {counts[s]}
              </span>
            </button>
          );
        })}
      </div>
      <button
        type="button"
        onClick={onToggleAll}
        className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg border border-border bg-card text-[12px] font-medium text-muted-foreground hover:text-foreground hover:bg-secondary/60 transition-colors shrink-0"
      >
        <ChevronDown className={`h-3.5 w-3.5 transition-transform ${allCollapsed ? "-rotate-90" : ""}`} />
        {allCollapsed ? "Tout déplier" : "Tout replier"}
      </button>
    </div>
  );
}

function Metric({ label, value, className }: { label: string; value: string; className?: string }) {
  return (
    <div className={`min-w-[42px] text-right ${className ?? ""}`}>
      <p className="text-[15px] font-bold tnum leading-none text-foreground">{value}</p>
      <p className="text-[9px] uppercase tracking-wider text-muted-foreground mt-0.5">{label}</p>
    </div>
  );
}

/* ═════════════════════════════════════════════════════════════
   Ligne commande — repliable vers le détail des lignes
═════════════════════════════════════════════════════════════ */
function OrderRow({
  doc, carriers, onCarrierChange, onDateChange, tournees, onLoadTournees, onTourneeChange,
}: {
  doc: Doc;
  carriers: CarrierOption[];
  onCarrierChange: (docEntry: number, sapValue: string) => Promise<boolean>;
  onDateChange: (docEntry: number, dueDate: string) => Promise<boolean>;
  tournees: Tournee[] | undefined;
  onLoadTournees: (code: string) => void;
  onTourneeChange: (docEntry: number, trspCode: string, heure: string) => Promise<boolean>;
}) {
  const [open, setOpen] = useState(false);
  const [savingCarrier, setSavingCarrier] = useState(false);
  const [savingTournee, setSavingTournee] = useState(false);

  // Charge les tournées du transporteur courant (une fois) pour le sélecteur.
  useEffect(() => {
    if (doc.open && doc.trspCode) onLoadTournees(doc.trspCode);
  }, [doc.open, doc.trspCode, onLoadTournees]);

  async function handleTournee(heure: string) {
    if (!doc.trspCode || heure === (doc.trspHeure ?? "")) return;
    setSavingTournee(true);
    await onTourneeChange(doc.docEntry, doc.trspCode, heure);
    setSavingTournee(false);
  }

  // Date de livraison (DocDueDate) — modifiable directement sur la ligne. Au
  // changement → PATCH + rechargement (la commande quitte la vue si elle bouge).
  const dueISO = (doc.dueDate ?? "").slice(0, 10);
  const [savingDate, setSavingDate] = useState(false);
  async function handleDate(value: string) {
    if (!value || value === dueISO) return;
    setSavingDate(true);
    await onDateChange(doc.docEntry, value);
    setSavingDate(false);
  }

  // N° de commande (réf. client) — éditable directement sur la ligne. Sauvé sur
  // blur/Entrée (PATCH NumAtCard) seulement si modifié. `savedRef` = dernière
  // valeur enregistrée (évite de muter la prop `doc` et les ré-enregistrements).
  const [refDraft, setRefDraft] = useState(doc.numAtCard ?? "");
  const [savedRef, setSavedRef] = useState(doc.numAtCard ?? "");
  const [savingRef, setSavingRef] = useState(false);
  async function saveRef() {
    const val = refDraft.trim();
    if (val === savedRef.trim()) return;   // inchangé
    setSavingRef(true);
    try {
      const res = await fetch(`/api/sap/orders/${doc.docEntry}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ numAtCard: val }),
      });
      const j = await res.json().catch(() => null);
      if (!res.ok || j?.ok === false) {
        toast.error(j?.error ? `Échec : ${j.error}` : "Échec de l'enregistrement du n° de commande");
        setRefDraft(savedRef);   // rollback affichage
        return;
      }
      setSavedRef(val);
      toast.success(val ? `N° de commande enregistré (#${doc.docNum})` : `N° de commande retiré (#${doc.docNum})`);
    } catch {
      toast.error("SAP injoignable — n° de commande non enregistré");
      setRefDraft(savedRef);
    } finally {
      setSavingRef(false);
    }
  }

  // Statut « faite » (préparée) — MANUEL, basculé directement ici. Optimiste +
  // persistance par DocEntry (aucune déduction auto depuis l'inventaire).
  const [prepared, setPrepared] = useState(doc.prepared);
  const [savingPrep, setSavingPrep] = useState(false);
  async function togglePrepared() {
    const next = !prepared;
    setPrepared(next);
    setSavingPrep(true);
    try {
      const res = await fetch("/api/livraisons/prepared", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ docEntry: doc.docEntry, prepared: next }),
      });
      const j = await res.json().catch(() => null);
      if (!res.ok || j?.ok === false) { setPrepared(!next); toast.error(j?.error ? `Échec : ${j.error}` : "Échec de l'enregistrement"); return; }
    } catch { setPrepared(!next); toast.error("Échec de l'enregistrement"); }
    finally { setSavingPrep(false); }
  }

  // Le transporteur courant doit rester sélectionnable même s'il n'est pas dans
  // la table Carrier (code SAP brut) → on l'injecte en tête si besoin.
  const options: CarrierOption[] = useMemo(() => {
    const base = carriers.slice();
    if (doc.trspCode && !base.some((c) => c.sapValue === doc.trspCode)) {
      base.unshift({ name: doc.carrierName ?? doc.trspCode, sapValue: doc.trspCode });
    }
    return base;
  }, [carriers, doc.trspCode, doc.carrierName]);

  async function handleCarrier(value: string) {
    if (value === (doc.trspCode ?? "")) return;
    setSavingCarrier(true);
    await onCarrierChange(doc.docEntry, value);
    setSavingCarrier(false);
  }

  // Modification : on résout le client puis on DIFFUSE la cible à l'Écran 2 (même
  // fenêtre, aucun nouvel onglet). L'Écran 2 bascule en saisie sur ce BL (mode
  // collant) et pré-remplit le panier avec ses lignes, éditables.
  const [modifBusy, setModifBusy] = useState(false);
  async function startModif() {
    setModifBusy(true);
    try {
      const r = await fetch(`/api/clients/resolve?code=${encodeURIComponent(doc.cardCode)}`);
      const j = await r.json().catch(() => null);
      if (!j?.id) {
        toast.error("Client introuvable en télévente — modification impossible depuis ici.");
        return;
      }
      broadcastActiveClient({
        clientId: j.id,
        clientName: doc.cardName,
        stockSharePct: 100,
        client: null,
        modif: { docEntry: doc.docEntry, docNum: doc.docNum },
      });
      toast.success(`Modification du BL #${doc.docNum} chargée sur l'Écran 2`, {
        description: "La saisie s'ouvre sur l'Écran 2 (même fenêtre).",
        duration: 6000,
      });
    } catch {
      toast.error("Échec du chargement de la modification.");
    } finally {
      setModifBusy(false);
    }
  }

  return (
    <li>
      <div className={`flex items-center gap-3 px-4 sm:px-5 py-3 hover:bg-secondary/25 transition-colors ${doc.excluded ? "opacity-50" : ""}`}>
        {/* Identité client */}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <ClientLink
              code={doc.cardCode}
              name={doc.cardName}
              className="text-[14.5px] font-semibold text-foreground truncate text-left hover:underline decoration-brand-500/60 underline-offset-2 max-w-full"
            />
            {doc.clientType && (SEG_UI[doc.clientType as Exclude<Segment, "ALL">] ?? null) && (
              <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[9.5px] font-bold uppercase tracking-wide ${SEG_UI[doc.clientType as Exclude<Segment, "ALL">].badge}`}>
                {SEG_UI[doc.clientType as Exclude<Segment, "ALL">].label}
              </span>
            )}
            <button
              type="button"
              onClick={togglePrepared}
              disabled={savingPrep}
              title={prepared ? "Commande préparée (faite) — cliquer pour annuler" : "Marquer la commande comme préparée (faite)"}
              className={`inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[9.5px] font-bold uppercase tracking-wide transition-colors disabled:opacity-60 ${
                prepared
                  ? "bg-emerald-500 text-white hover:bg-emerald-600"
                  : "border border-border text-muted-foreground hover:border-foreground/40 hover:text-foreground"
              }`}
            >
              {savingPrep ? <Loader2 className="h-2.5 w-2.5 animate-spin" /> : <CheckCircle2 className="h-2.5 w-2.5" />}
              {prepared ? "Faite" : "À préparer"}
            </button>
            {!doc.open && (
              <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/12 text-emerald-600 dark:text-emerald-400 px-1.5 py-0.5 text-[9.5px] font-bold uppercase tracking-wide">
                <CheckCircle2 className="h-2.5 w-2.5" /> Livrée
              </span>
            )}
            {doc.excluded && (
              <span title="BL totalement avoiré (facturé puis avoir total / doublon) — déduit des totaux"
                className="inline-flex items-center gap-1 rounded-full bg-rose-500 text-white px-1.5 py-0.5 text-[9.5px] font-bold uppercase tracking-wide">
                <RotateCcw className="h-2.5 w-2.5" /> Avoir — déduit
              </span>
            )}
          </div>
          <div className="flex items-center gap-2 mt-0.5 text-[11px] text-muted-foreground flex-wrap">
            <span className="font-mono text-foreground/60">{doc.cardCode}</span>
            <span>· BL n°{doc.docNum}</span>
            <span className="hidden sm:inline">· {fmtEur(doc.totalHT)} HT</span>
          </div>
          {/* Changement de transporteur direct */}
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            <Truck className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
            <div className="relative">
              <select
                value={doc.trspCode ?? ""}
                disabled={savingCarrier || !doc.open}
                onChange={(e) => handleCarrier(e.target.value)}
                aria-label={`Transporteur de la commande ${doc.docNum}`}
                title={doc.open ? "Changer le transporteur" : "Commande livrée — transporteur figé"}
                className="h-7 max-w-[200px] rounded-md border border-border bg-card pl-2 pr-7 text-[11.5px] font-medium text-foreground focus:outline-none focus:ring-2 focus:ring-brand-500/40 disabled:opacity-60 disabled:cursor-not-allowed appearance-none truncate cursor-pointer"
              >
                <option value="">Non affecté</option>
                {options.map((c) => (
                  <option key={c.sapValue} value={c.sapValue}>{c.name}</option>
                ))}
              </select>
              {savingCarrier ? (
                <Loader2 className="pointer-events-none absolute right-1.5 top-1/2 -translate-y-1/2 h-3 w-3 animate-spin text-muted-foreground" />
              ) : (
                <ChevronDown className="pointer-events-none absolute right-1.5 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground" />
              )}
            </div>
            {/* Tournée du transporteur → fixe l'heure (U_TrspHeur). Visible dès qu'un
                transporteur est affecté et la commande ouverte. */}
            {doc.open && doc.trspCode && (
              <div className="relative">
                <select
                  value={doc.trspHeure ?? ""}
                  disabled={savingTournee || !tournees}
                  onChange={(e) => handleTournee(e.target.value)}
                  aria-label={`Tournée de la commande ${doc.docNum}`}
                  title={tournees ? "Choisir la tournée (fixe l'heure)" : "Chargement des tournées…"}
                  className="h-7 max-w-[220px] rounded-md border border-border bg-card pl-2 pr-7 text-[11.5px] font-medium text-foreground focus:outline-none focus:ring-2 focus:ring-brand-500/40 disabled:opacity-60 disabled:cursor-not-allowed appearance-none truncate cursor-pointer"
                >
                  <option value="">{tournees ? "Tournée…" : "Chargement…"}</option>
                  {doc.trspHeure && !(tournees ?? []).some((t) => t.heure === doc.trspHeure) && (
                    <option value={doc.trspHeure}>{doc.trspHeure.slice(0, 5)} (actuelle)</option>
                  )}
                  {(tournees ?? []).filter((t) => t.heure).map((t) => (
                    <option key={t.lineId} value={t.heure as string}>
                      {t.nom}{t.des ? ` (${t.des})` : ""} — {(t.heure as string).slice(0, 5)}
                    </option>
                  ))}
                </select>
                {savingTournee ? (
                  <Loader2 className="pointer-events-none absolute right-1.5 top-1/2 -translate-y-1/2 h-3 w-3 animate-spin text-muted-foreground" />
                ) : (
                  <Clock className="pointer-events-none absolute right-1.5 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground" />
                )}
              </div>
            )}
            {/* N° de commande (réf. client) — éditable directement ici */}
            <div className="relative inline-flex items-center">
              <FileText className="pointer-events-none absolute left-2 h-3 w-3 text-muted-foreground" />
              <input
                value={refDraft}
                onChange={(e) => setRefDraft(e.target.value)}
                onBlur={saveRef}
                onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }}
                disabled={savingRef}
                placeholder="N° commande"
                title="N° de commande (réf. client) — Entrée ou clic ailleurs pour enregistrer"
                aria-label={`N° de commande de la livraison ${doc.docNum}`}
                className="h-7 w-[140px] rounded-md border border-border bg-card pl-7 pr-6 text-[11.5px] font-medium text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:ring-2 focus:ring-brand-500/40 disabled:opacity-60"
              />
              {savingRef && <Loader2 className="pointer-events-none absolute right-1.5 h-3 w-3 animate-spin text-muted-foreground" />}
            </div>
            {/* Date de livraison — modifiable directement ici */}
            <div className="relative inline-flex items-center">
              <CalendarDays className="pointer-events-none absolute left-2 h-3 w-3 text-muted-foreground" />
              <input
                type="date"
                value={dueISO}
                disabled={savingDate || !doc.open}
                onChange={(e) => e.target.value && handleDate(e.target.value)}
                title={doc.open ? "Changer la date de livraison du BL" : "Commande livrée — date figée"}
                aria-label={`Date de livraison de la commande ${doc.docNum}`}
                className="h-7 rounded-md border border-border bg-card pl-7 pr-2 text-[11.5px] font-medium text-foreground tnum focus:outline-none focus:ring-2 focus:ring-brand-500/40 disabled:opacity-60 disabled:cursor-not-allowed"
              />
              {savingDate && <Loader2 className="pointer-events-none absolute right-1.5 h-3 w-3 animate-spin text-muted-foreground" />}
            </div>
          </div>
        </div>

        {/* Colis / poids — repère logistique */}
        <div className="flex items-center gap-6 sm:gap-8 shrink-0">
          <div className="text-right min-w-[44px]">
            <p className="text-[15px] font-bold tnum text-foreground leading-none">{fmtNum(doc.colis)}</p>
            <p className="text-[9px] uppercase tracking-wider text-muted-foreground mt-0.5">colis</p>
          </div>
          <div className="text-right min-w-[44px]">
            <p className="text-[15px] font-bold tnum text-foreground leading-none">{fmtNum(doc.weightKg)}</p>
            <p className="text-[9px] uppercase tracking-wider text-muted-foreground mt-0.5">kg</p>
          </div>
          {doc.open && (
            <button
              type="button"
              onClick={startModif}
              disabled={modifBusy}
              title={`Modifier le BL #${doc.docNum} (sur l'Écran 2) — quantités + ajout de lignes`}
              className="inline-flex items-center gap-1 h-9 px-2.5 rounded-lg border border-amber-300/70 dark:border-amber-500/40 bg-amber-50 dark:bg-amber-900/20 text-[12px] font-semibold text-amber-700 dark:text-amber-300 hover:bg-amber-100 dark:hover:bg-amber-900/35 active:scale-95 transition-all disabled:opacity-60"
            >
              {modifBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Pencil className="h-3.5 w-3.5" strokeWidth={2.2} />}
              <span className="hidden sm:inline">Modifier</span>
            </button>
          )}
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
