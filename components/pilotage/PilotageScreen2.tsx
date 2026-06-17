"use client";

import { useEffect, useMemo, useState } from "react";
import { ArrowUp, ArrowDown, Minus, X } from "lucide-react";
import {
  Tile, TopList, RefreshButton, formatEuro,
} from "./bento";
import {
  useAnnualData, useWeeklyData, type WeeklyPayload,
} from "./usePilotageData";
import { TrendArea, type TrendPoint } from "@/components/charts/TrendArea";
import { BarList } from "@/components/charts/BarList";
import { Donut } from "@/components/charts/Donut";
import {
  isoWeek, isoWeekLabel, isoWeeksInYear, isoWeekKey, COMMERCIAL_EVENTS,
} from "@/lib/iso-week";
import { SEGMENTS, type Segment } from "@/lib/segments";
import { grossMarginPct } from "@/lib/margin";

type Screen2View = "matrix" | "evolution" | "events";
/** Métrique affichée : CA HT (€), Poids (kg), ou Marge % (marge brute / CA produit net). */
type Metric = "ca" | "weight" | "marginPct";

/** Marge BRUTE % = marge / CA produit NET — base unique partagée (lib/margin),
 *  identique écran 1 / écran 2 / matrice / tops. */
const marginPctOf = grossMarginPct;

function metricLabel(m: Metric): string {
  return m === "ca" ? "CA HT" : m === "weight" ? "Poids" : "Marge %";
}

/** Formateur de valeur pour les TopList selon la métrique (undefined = € compact par défaut). */
function topFmt(m: Metric): ((v: number) => string) | undefined {
  if (m === "weight") return formatWeight;
  if (m === "marginPct") return (v) => `${v.toFixed(1)} %`;
  return undefined;
}

/**
 * Écran 2 — Rapport annuel comptable (Invoices).
 *
 * Source = SapInvoice. Pas de switch granularité (rapport pure-année). À la
 * place : toggle CA HT / Poids (kg/t) + drill-in mois (clic cellule).
 *
 * Disposition 12×6 :
 *   ┌─── Matrice CA/Poids × 3 ans (12×3 héros, format rapport) ────┐
 *   ├ Top clients année (4×3) │ Top fournisseurs (4×3) │ Top SLP ─┤
 *   └──────────────────────────────────────────────────────────────┘
 */
export function PilotageScreen2({ viewAs = null }: { viewAs?: string | null } = {}) {
  const [segment, setSegment] = useState<Segment>("ALL");
  const [refreshNonce, setRefreshNonce] = useState(0);
  const { data, err } = useAnnualData(segment, viewAs, refreshNonce);
  const { data: weekly } = useWeeklyData(segment, viewAs, refreshNonce);
  // 1er chargement annuel : ni data ni erreur encore → on évite d'afficher
  // « Aucune donnée / backfill » (faux négatif tant que le fetch n'a pas répondu).
  const annualLoading = data === null && err === null;
  const [mode, setMode] = useState<Metric>("ca");
  const [view, setView] = useState<Screen2View>("matrix");
  const [drill, setDrill] = useState<{ year: number; month: number } | null>(null);
  // Comparatif N-1 sur la courbe d'évolution mensuelle — cochable + mémorisé.
  const [compareN1, setCompareN1] = useState(true);
  useEffect(() => {
    try {
      const v = localStorage.getItem("televente:pilotageCompareN1");
      if (v != null) setCompareN1(v !== "off");
    } catch { /* localStorage indispo */ }
  }, []);
  const setCompare = (v: boolean) => {
    setCompareN1(v);
    try { localStorage.setItem("televente:pilotageCompareN1", v ? "on" : "off"); } catch { /* noop */ }
  };
  const monthlyTrend = useMemo(() => buildMonthlyTrend(data?.matrix ?? [], mode, compareN1), [data, mode, compareN1]);

  // Tops RE-triés selon la métrique active (CA / Poids / Marge %) — pas l'ordre API.
  const sortedClients = useMemo(() => {
    const v = (c: { ca: number; weightKg: number; margin: number; caProductNet: number }) =>
      mode === "ca" ? c.ca : mode === "weight" ? c.weightKg : marginPctOf(c.margin, c.caProductNet);
    return [...(data?.clients ?? [])].sort((a, b) => v(b) - v(a));
  }, [data, mode]);
  const sortedSuppliers = useMemo(() => {
    const v = (s: { totalIn: number; weightKg: number }) => mode === "weight" ? s.weightKg : s.totalIn;
    return [...(data?.suppliers ?? [])].sort((a, b) => v(b) - v(a));
  }, [data, mode]);
  const sortedSlp = useMemo(() => {
    const v = (s: { ca: number; weightKg: number; margin: number; caProductNet: number }) =>
      mode === "ca" ? s.ca : mode === "weight" ? s.weightKg : marginPctOf(s.margin, s.caProductNet);
    return [...(data?.salespersons ?? [])].sort((a, b) => v(b) - v(a));
  }, [data, mode]);

  const segmentSuffix = segment === "ALL"
    ? "" : ` · ${SEGMENTS.find((s) => s.id === segment)?.label ?? segment}`;
  const periodBase =
    view === "evolution" ? (weekly ? `Évolution hebdo · ${weekly.currentYear} vs ${weekly.currentYear - 1}` : "—")
    : view === "events" ? (weekly ? `Semaines à événement · ${weekly.currentYear} vs ${weekly.currentYear - 1}` : "—")
    : (data ? `Réf. ${data.currentYear} · comparatifs N-1/N-2` : "—");
  const periodLabel = periodBase === "—" ? periodBase : periodBase + segmentSuffix;

  return (
    <div className="h-screen w-screen flex flex-col p-3 gap-3 overflow-hidden">
      <Header
        screen="Rapport annuel · CA facturé (comptable)"
        period={periodLabel}
        mode={mode}
        onMode={setMode}
        showModeToggle={view === "matrix"}
        view={view}
        onView={setView}
        segment={segment}
        onSegment={setSegment}
        onRefresh={() => setRefreshNonce((n) => n + 1)}
      />

      {view === "matrix" && err && (
        <div className="flex-1 grid place-items-center">
          <div className="flex flex-col items-center gap-3 text-center">
            <p className="text-[13px] text-rose-400">Erreur de chargement : {err}</p>
            <button
              type="button"
              onClick={() => setRefreshNonce((n) => n + 1)}
              className="px-3 h-8 text-[12px] font-semibold tracking-tight rounded-md bg-secondary/60 text-foreground hover:bg-secondary transition-colors"
            >
              Réessayer
            </button>
          </div>
        </div>
      )}

      {view === "matrix" && !err && annualLoading && (
        <div className="flex-1 grid place-items-center text-[13px] text-muted-foreground">
          Chargement du rapport annuel…
        </div>
      )}

      {view === "matrix" && !err && !annualLoading && (
        <main
          className="flex-1 grid gap-2 min-h-0"
          style={{ gridTemplateColumns: "repeat(12, minmax(0, 1fr))", gridTemplateRows: "repeat(6, minmax(0, 1fr))" }}
        >
          <Tile colSpan={8} rowSpan={3} title={`Matrice ${metricLabel(mode)} · mois × 3 ans (Invoices)`} accent="brand">
            <AnnualMatrixTable
              data={data?.matrix ?? []}
              mode={mode}
              onCell={(year, month) => setDrill({ year, month })}
            />
          </Tile>

          <Tile colSpan={4} rowSpan={3}
            title={`Évolution mensuelle ${metricLabel(mode)} · ${data?.currentYear ?? "N"}${compareN1 ? ` vs ${(data?.currentYear ?? 0) - 1}` : ""}`}
            accent="violet">
            <div className="h-full flex flex-col min-h-0">
              <div className="shrink-0 flex justify-end pb-1">
                <CompareToggle
                  checked={compareN1}
                  onChange={setCompare}
                  prevYear={(data?.currentYear ?? new Date().getFullYear()) - 1}
                />
              </div>
              <div className="flex-1 min-h-0">
                {monthlyTrend.length > 0 ? (
                  <TrendArea
                    data={monthlyTrend}
                    tone="violet"
                    height="100%"
                    className="h-full"
                    format={(v) => formatValue(v, mode)}
                    currentLabel={String(data?.currentYear ?? "N")}
                    compareLabel={String((data?.currentYear ?? 0) - 1)}
                    aria-label="Évolution mensuelle, année courante comparée à l'an dernier"
                  />
                ) : (
                  <div className="h-full flex items-center justify-center text-[12px] text-muted-foreground">
                    Données indisponibles.
                  </div>
                )}
              </div>
            </div>
          </Tile>

          <Tile colSpan={4} rowSpan={3} title={`Top clients ${data?.currentYear ?? "N"} · ${metricLabel(mode)}`} accent="brand">
            <TopList
              items={sortedClients.slice(0, 8).map((c) => ({
                name: c.cardName ?? c.cardCode,
                value: mode === "ca" ? c.ca : mode === "weight" ? c.weightKg : marginPctOf(c.margin, c.caProductNet),
                sub: mode === "ca" ? `${formatEuro(c.margin, true)} marge · ${c.invoices} fact.`
                  : mode === "weight" ? `${formatEuro(c.ca, true)} CA · ${c.invoices} fact.`
                  : `${formatEuro(c.ca, true)} CA · ${formatEuro(c.margin, true)} marge`,
              }))}
              fmt={topFmt(mode)}
            />
          </Tile>

          <Tile colSpan={4} rowSpan={3}
            title={`Top fournisseurs ${data?.currentYear ?? "N"} · ${mode === "weight" ? "Poids" : "Achats"}`}
            accent="amber">
            <TopList
              items={sortedSuppliers.slice(0, 6).map((s) => ({
                // Pas de marge sur les achats → en mode Marge % on garde la valeur d'achats.
                name: s.cardName ?? s.cardCode,
                value: mode === "weight" ? s.weightKg : s.totalIn,
                sub: mode === "weight" ? `${formatEuro(s.totalIn, true)} · ${s.pdnCount} BL` : `${s.pdnCount} BL`,
              }))}
              fmt={mode === "weight" ? formatWeight : undefined}
            />
          </Tile>

          <Tile colSpan={4} rowSpan={3} title={`Top commerciaux ${data?.currentYear ?? "N"} · ${metricLabel(mode)}`} accent="violet">
            <TopList
              items={sortedSlp.slice(0, 6).map((s) => ({
                name: s.slpName,
                value: mode === "ca" ? s.ca : mode === "weight" ? s.weightKg : marginPctOf(s.margin, s.caProductNet),
                sub: mode === "ca" ? `${s.activeClients} clients · ${formatEuro(s.margin, true)} marge`
                  : mode === "weight" ? `${formatEuro(s.ca, true)} CA · ${s.activeClients} clients`
                  : `${s.activeClients} clients · ${formatEuro(s.ca, true)} CA`,
              }))}
              fmt={topFmt(mode)}
            />
          </Tile>
        </main>
      )}

      {view === "evolution" && <EvolutionView weekly={weekly} />}
      {view === "events" && <EventsView weekly={weekly} />}

      {drill && (
        <MonthDrilldownDrawer
          year={drill.year}
          month={drill.month}
          mode={mode === "marginPct" ? "ca" : mode}
          segment={segment}
          viewAs={viewAs}
          onClose={() => setDrill(null)}
        />
      )}
    </div>
  );
}

/** Série mensuelle N vs N-1 dérivée de la matrice annuelle (pour la vue Matrice).
 *  La courbe N **s'arrête au mois M-1** : les mois ≥ mois courant sont à venir
 *  (ou incomplets dans le miroir) → on ne trace pas une queue plate vers 0. */
type MatrixMonthLite = { ca: number; weightKg: number; margin: number; caProductNet: number };

function buildMonthlyTrend(
  matrix: { year: number; months: MatrixMonthLite[] }[],
  mode: Metric,
  compareN1 = true,
  ref: Date = new Date(),
): TrendPoint[] {
  if (matrix.length === 0) return [];
  const years = [...matrix].sort((a, b) => a.year - b.year);
  const cur = years[years.length - 1];
  // Comparatif N-1 désactivable (case « Comparer N-1 » sur la tuile).
  const prev = compareN1 && years.length >= 2 ? years[years.length - 2] : null;
  const valOf = (mo?: MatrixMonthLite) =>
    mode === "ca" ? mo?.ca ?? 0
    : mode === "weight" ? mo?.weightKg ?? 0
    : marginPctOf(mo?.margin ?? 0, mo?.caProductNet ?? 0);
  // En mode Marge % : info secondaire €/kg (marge € / poids kg) dans le tooltip.
  const perKgSub = (mo?: MatrixMonthLite) =>
    mode === "marginPct" && mo && mo.weightKg > 0 ? formatPerKg(mo.margin, mo.weightKg) : undefined;

  // Borne haute = mois précédent le mois courant. Au sein de cette borne on
  // s'arrête au dernier mois réellement renseigné (data du miroir parfois en retard).
  const capM = ref.getMonth() - 1; // ex. juin (5) → mai (4)
  let lastM = -1;
  for (let m = 0; m <= Math.min(11, capM); m++) if (valOf(cur.months[m]) > 0) lastM = m;
  if (lastM < 0) return []; // tout début d'année : aucun mois complet encore

  return Array.from({ length: lastM + 1 }, (_, m) => ({
    label: MOIS_FR[m],
    value: valOf(cur.months[m]),
    compare: prev ? valOf(prev.months[m]) : undefined,
    sub: perKgSub(cur.months[m]),
    compareSub: prev ? perKgSub(prev.months[m]) : undefined,
  }));
}

/** Case « Comparer N-1 » de la courbe d'évolution mensuelle. */
function CompareToggle({
  checked, onChange, prevYear,
}: { checked: boolean; onChange: (v: boolean) => void; prevYear: number }) {
  return (
    <label className="inline-flex items-center gap-1.5 text-[10.5px] font-medium text-muted-foreground hover:text-foreground cursor-pointer select-none">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="h-3 w-3 rounded-[3px] border-border accent-violet-500 cursor-pointer"
      />
      Comparer {prevYear}
    </label>
  );
}

/* ═════════════════════════════════════════════════════════════════
   VUE ÉVOLUTION — courbes hebdomadaires N vs N-1 par semaine ISO.
   A1 (n° de semaine) + A2 (graphes d'évolution).
   ═════════════════════════════════════════════════════════════════ */

/** Dernière semaine ISO de l'année N réellement présente dans le miroir
 *  (le backfill peut être en retard de quelques semaines sur aujourd'hui). */
function lastDataWeekN(weekly: WeeklyPayload): number {
  let last = 0;
  for (const w of weekly.weeks) if (w.isoYear === weekly.currentIsoYear && w.week > last) last = w.week;
  return last;
}

/** Construit deux séries TrendPoint (CA + marge) alignées par n° de semaine ISO. */
function buildWeeklySeries(weekly: WeeklyPayload | null): { ca: TrendPoint[]; margin: TrendPoint[] } | null {
  if (!weekly) return null;
  const isoYearN = weekly.currentIsoYear;
  const isoYearPrev = isoYearN - 1;

  const curMap = new Map<number, { ca: number; margin: number }>();
  const prevMap = new Map<number, { ca: number; margin: number }>();
  for (const w of weekly.weeks) {
    if (w.isoYear === isoYearN) curMap.set(w.week, { ca: w.ca, margin: w.margin });
    else if (w.isoYear === isoYearPrev) prevMap.set(w.week, { ca: w.ca, margin: w.margin });
  }

  // On trace N jusqu'à la dernière semaine remontée (évite un faux retour à 0
  // sur les semaines pas encore synchronisées). N-1 reste comparé semaine à semaine.
  const upTo = Math.max(1, Math.min(lastDataWeekN(weekly) || weekly.currentWeek, isoWeeksInYear(isoYearN)));

  const ca: TrendPoint[] = [];
  const margin: TrendPoint[] = [];
  for (let wk = 1; wk <= upTo; wk++) {
    const c = curMap.get(wk);
    const p = prevMap.get(wk);
    const label = isoWeekLabel(wk);
    ca.push({ label, value: c?.ca ?? 0, compare: p?.ca ?? 0 });
    margin.push({ label, value: c?.margin ?? 0, compare: p?.margin ?? 0 });
  }
  return { ca, margin };
}

function EvolutionView({ weekly }: { weekly: WeeklyPayload | null }) {
  const series = useMemo(() => buildWeeklySeries(weekly), [weekly]);
  const yearN = weekly?.currentYear ?? new Date().getFullYear();

  if (!series) {
    return (
      <main className="flex-1 flex items-center justify-center text-[13px] text-muted-foreground">
        Chargement de la série hebdomadaire…
      </main>
    );
  }

  return (
    <main
      className="flex-1 grid gap-2 min-h-0"
      style={{ gridTemplateColumns: "repeat(12, minmax(0, 1fr))", gridTemplateRows: "repeat(6, minmax(0, 1fr))" }}
    >
      <Tile colSpan={12} rowSpan={4} title={`Évolution CA hebdomadaire · ${yearN} vs ${yearN - 1} (semaine ISO)`} accent="brand">
        <TrendArea
          data={series.ca}
          tone="brand"
          height="100%"
          className="h-full"
          format={(v) => formatEuro(v, true)}
          currentLabel={String(yearN)}
          compareLabel={String(yearN - 1)}
          aria-label={`Évolution du CA hebdomadaire ${yearN} comparé à ${yearN - 1}, par numéro de semaine ISO`}
        />
      </Tile>

      <Tile colSpan={12} rowSpan={2} title={`Évolution marge hebdomadaire · ${yearN} vs ${yearN - 1}`} accent="violet">
        <TrendArea
          data={series.margin}
          tone="violet"
          height="100%"
          className="h-full"
          format={(v) => formatEuro(v, true)}
          currentLabel={String(yearN)}
          compareLabel={String(yearN - 1)}
          aria-label={`Évolution de la marge hebdomadaire ${yearN} comparée à ${yearN - 1}`}
        />
      </Tile>
    </main>
  );
}

/* ═════════════════════════════════════════════════════════════════
   VUE ÉVÉNEMENTS — semaines à événement (Pâques, fête des mères…).
   A5 : pour chaque événement, CA de SA semaine ISO en N vs N-1.
   ═════════════════════════════════════════════════════════════════ */

interface EventRow {
  key: string;
  label: string;
  emoji: string;
  weekN: number;
  caPrev: number | null;
  caN: number | null;
  future: boolean;
}

function buildEventRows(weekly: WeeklyPayload | null): EventRow[] {
  if (!weekly) return [];
  const yearN = weekly.currentYear;
  const map = new Map<string, { ca: number; margin: number }>();
  for (const w of weekly.weeks) map.set(isoWeekKey({ year: w.isoYear, week: w.week }), { ca: w.ca, margin: w.margin });
  const lastWeekN = lastDataWeekN(weekly);

  return COMMERCIAL_EVENTS.map((ev) => {
    const wN = isoWeek(ev.date(yearN));
    const wPrev = isoWeek(ev.date(yearN - 1));
    const bucketN = map.get(isoWeekKey(wN));
    const bucketPrev = map.get(isoWeekKey(wPrev));
    // « à venir » = semaine de l'événement N au-delà de ce que le miroir a remonté.
    const future = wN.year > weekly.currentIsoYear
      || (wN.year === weekly.currentIsoYear && wN.week > lastWeekN);
    return {
      key: ev.key,
      label: ev.label,
      emoji: ev.emoji,
      weekN: wN.week,
      caPrev: bucketPrev?.ca ?? null,
      caN: future ? null : (bucketN?.ca ?? 0),
      future,
    };
  }).sort((a, b) => a.weekN - b.weekN);
}

function EventsView({ weekly }: { weekly: WeeklyPayload | null }) {
  const rows = useMemo(() => buildEventRows(weekly), [weekly]);
  const yearN = weekly?.currentYear ?? new Date().getFullYear();

  if (!weekly) {
    return (
      <main className="flex-1 flex items-center justify-center text-[13px] text-muted-foreground">
        Chargement des semaines à événement…
      </main>
    );
  }

  return (
    <main className="flex-1 min-h-0 grid gap-2"
      style={{ gridTemplateColumns: "repeat(12, minmax(0, 1fr))", gridTemplateRows: "repeat(6, minmax(0, 1fr))" }}>
      <Tile colSpan={8} rowSpan={6} title={`Semaines à événement · CA ${yearN} vs ${yearN - 1}`} accent="brand">
        <div className="h-full overflow-auto">
          <table className="w-full text-[12px] tabular-nums">
            <thead className="sticky top-0 bg-card z-10">
              <tr className="border-b border-border text-[9.5px] uppercase tracking-[0.12em] font-semibold text-muted-foreground">
                <th className="text-left px-2 py-1.5">Événement</th>
                <th className="text-center px-2 py-1.5">Sem.</th>
                <th className="text-right px-2 py-1.5">{yearN - 1}</th>
                <th className="text-right px-2 py-1.5">{yearN}</th>
                <th className="text-right px-2 py-1.5">Δ</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/50">
              {rows.map((r) => (
                <tr key={r.key} className="hover:bg-secondary/30 transition-colors">
                  <td className="px-2 py-1.5 font-medium text-foreground">
                    <span className="mr-1.5">{r.emoji}</span>{r.label}
                  </td>
                  <td className="px-2 py-1.5 text-center text-muted-foreground font-semibold">{isoWeekLabel(r.weekN)}</td>
                  <td className="px-2 py-1.5 text-right text-muted-foreground">
                    {r.caPrev != null && r.caPrev !== 0 ? formatEuro(r.caPrev, true) : "—"}
                  </td>
                  <td className="px-2 py-1.5 text-right font-semibold text-foreground">
                    {r.future ? <span className="text-[10.5px] uppercase tracking-wide text-sky-500/80">à venir</span>
                      : r.caN != null && r.caN !== 0 ? formatEuro(r.caN, true) : "—"}
                  </td>
                  <td className="px-2 py-1.5 text-right">
                    {r.future || r.caPrev == null ? <span className="text-muted-foreground">—</span>
                      : <DeltaCell curr={r.caN ?? 0} prev={r.caPrev} />}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Tile>

      <Tile colSpan={4} rowSpan={6} title={`Top semaines événement ${yearN - 1} (réf.)`} accent="amber">
        <BarList
          className="space-y-0.5"
          max={8}
          items={[...rows]
            .filter((r) => r.caPrev != null && r.caPrev > 0)
            .sort((a, b) => (b.caPrev ?? 0) - (a.caPrev ?? 0))
            .map((r) => ({ label: `${r.emoji} ${r.label}`, value: r.caPrev ?? 0, hint: isoWeekLabel(r.weekN) }))}
          format={(v) => formatEuro(v, true)}
        />
      </Tile>
    </main>
  );
}

/* ─────────────────────────────────────────────────────────────────
   Format helpers
   ───────────────────────────────────────────────────────────────── */

function formatWeight(kg: number): string {
  if (Math.abs(kg) >= 1000) return `${(kg / 1000).toFixed(1)} t`;
  if (Math.abs(kg) >= 1) return `${Math.round(kg)} kg`;
  return "—";
}

/** Marge moyenne €/kg (= marge € / poids kg) — affichée à côté de la Marge %. */
function formatPerKg(margin: number, weightKg: number): string {
  if (!(weightKg > 0)) return "—";
  const v = margin / weightKg;
  if (!Number.isFinite(v) || v === 0) return "—";
  return `${v.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €/kg`;
}

function formatValue(v: number, mode: Metric): string {
  if (mode === "marginPct") return `${v.toFixed(1)} %`;
  return mode === "ca" ? formatEuro(v, true) : formatWeight(v);
}

/* ─────────────────────────────────────────────────────────────────
   Matrice annuelle — clic cellule = onCell(year, month).
   ───────────────────────────────────────────────────────────────── */
const MOIS_FR = ["Jan", "Fév", "Mar", "Avr", "Mai", "Jui", "Jul", "Aoû", "Sep", "Oct", "Nov", "Déc"];
// Indexé par Date.getDay() (0=dimanche … 6=samedi) → initiale affichée sous chaque barre.
const WEEKDAY_INITIAL = ["D", "L", "M", "M", "J", "V", "S"];
// Indexé lundi=0 … dimanche=6 (pour les tooltips).
const WEEKDAYS_LONG_FR = ["Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi", "Samedi", "Dimanche"];

type MatrixMonth = { ca: number; margin: number; weightKg: number; caProductNet: number };
function AnnualMatrixTable({
  data, mode, onCell,
}: {
  data: { year: number; months: MatrixMonth[]; totalCa: number; totalMargin: number; totalWeightKg: number; totalCaProductNet: number }[];
  mode: Metric;
  onCell: (year: number, month: number) => void;
}) {
  if (data.length === 0) {
    return (
      <div className="h-full flex items-center justify-center text-[12px] text-muted-foreground">
        Aucune donnée annuelle disponible — lancer un backfill SAP.
      </div>
    );
  }
  const years = [...data].sort((a, b) => a.year - b.year);
  const currentYear = years[years.length - 1];
  const prevYear = years.length >= 2 ? years[years.length - 2] : null;

  const valOf = (m?: MatrixMonth) =>
    mode === "ca" ? m?.ca ?? 0
    : mode === "weight" ? m?.weightKg ?? 0
    : marginPctOf(m?.margin ?? 0, m?.caProductNet ?? 0);
  const totalOf = (y: typeof currentYear) =>
    mode === "ca" ? y.totalCa
    : mode === "weight" ? y.totalWeightKg
    : marginPctOf(y.totalMargin, y.totalCaProductNet);

  return (
    <div className="h-full flex flex-col min-h-0">
      {mode === "marginPct" && (
        <div className="shrink-0 px-2 pb-1.5 flex items-baseline gap-x-2 gap-y-0.5 flex-wrap text-[11.5px]">
          <span className="text-muted-foreground">Marge {currentYear.year}</span>
          <span className="font-semibold text-foreground tnum">
            {marginPctOf(currentYear.totalMargin, currentYear.totalCaProductNet).toFixed(1)} %
          </span>
          <span className="text-muted-foreground">· Marge moyenne</span>
          <span className="font-semibold text-foreground tnum">
            {formatPerKg(currentYear.totalMargin, currentYear.totalWeightKg)}
          </span>
        </div>
      )}
      <div className="flex-1 overflow-auto">
      <table className="w-full text-[11px] tabular-nums">
        <thead className="sticky top-0 bg-card z-10">
          <tr className="border-b border-border">
            <th className="text-left px-2 py-1.5 text-[9.5px] uppercase tracking-[0.12em] font-semibold text-muted-foreground">Mois</th>
            {years.map((y) => (
              <th key={y.year} className={`text-right px-2 py-1.5 text-[9.5px] uppercase tracking-[0.12em] font-semibold ${y.year === currentYear.year ? "text-foreground" : "text-muted-foreground"}`}>
                {y.year}
              </th>
            ))}
            <th className="text-center px-2 py-1.5 text-[9.5px] uppercase tracking-[0.12em] font-semibold text-muted-foreground">
              {years.length >= 3 ? "N-2·N-1·N" : "N-1·N"}
            </th>
            <th className="text-right px-2 py-1.5 text-[9.5px] uppercase tracking-[0.12em] font-semibold text-muted-foreground">
              {prevYear ? `Δ ${currentYear.year}/${prevYear.year}` : "—"}
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border/50">
          {Array.from({ length: 12 }, (_, m) => {
            const currVal = valOf(currentYear.months[m]);
            const prevVal = prevYear ? valOf(prevYear.months[m]) : 0;
            return (
              <tr key={m} className="hover:bg-secondary/30 transition-colors">
                <td className="px-2 py-1.5 font-semibold text-foreground/80">{MOIS_FR[m]}</td>
                {years.map((y) => {
                  const v = valOf(y.months[m]);
                  const mg = y.months[m]?.margin ?? 0;
                  const wkg = y.months[m]?.weightKg ?? 0;
                  const isCurr = y.year === currentYear.year;
                  return (
                    <td
                      key={y.year}
                      className={`px-2 py-1.5 text-right cursor-pointer hover:bg-brand-500/10 transition-colors ${isCurr ? "" : "text-muted-foreground"}`}
                      onClick={() => onCell(y.year, m)}
                      title="Clic pour drill-in"
                    >
                      <div className={`font-semibold ${isCurr ? "text-foreground" : ""}`}>
                        {v === 0 ? "—" : formatValue(v, mode)}
                      </div>
                      <div className="text-[9.5px] text-muted-foreground/80">
                        {mode === "marginPct"
                          ? (mg !== 0 ? formatPerKg(mg, wkg) : "")
                          : mode === "ca" && mg !== 0 ? `${formatEuro(mg, true)} mg` : ""}
                      </div>
                    </td>
                  );
                })}
                <td className="px-2 py-1.5">
                  <MiniYearBars
                    items={years.map((y) => ({ year: y.year, value: valOf(y.months[m]) }))}
                    currentYear={currentYear.year}
                    prevYear={prevYear?.year ?? null}
                    mode={mode}
                  />
                </td>
                <td className="px-2 py-1.5 text-right">
                  {prevYear ? <DeltaCell curr={currVal} prev={prevVal} /> : <span className="text-muted-foreground">—</span>}
                </td>
              </tr>
            );
          })}
          {/* Ligne total */}
          <tr className="border-t-2 border-border bg-secondary/30">
            <td className="px-2 py-2 font-bold text-foreground uppercase text-[10px] tracking-[0.12em]">Total</td>
            {years.map((y) => {
              const isCurr = y.year === currentYear.year;
              return (
                <td key={y.year} className={`px-2 py-2 text-right ${isCurr ? "" : "text-muted-foreground"}`}>
                  <div className={`font-bold ${isCurr ? "text-foreground" : ""}`}>
                    {formatValue(totalOf(y), mode)}
                  </div>
                  <div className="text-[9.5px] text-muted-foreground/80">
                    {mode === "marginPct" ? formatPerKg(y.totalMargin, y.totalWeightKg)
                      : mode === "ca" ? `${formatEuro(y.totalMargin, true)} mg` : ""}
                  </div>
                </td>
              );
            })}
            <td className="px-2 py-2">
              <MiniYearBars
                items={years.map((y) => ({ year: y.year, value: totalOf(y) }))}
                currentYear={currentYear.year}
                prevYear={prevYear?.year ?? null}
                mode={mode}
              />
            </td>
            <td className="px-2 py-2 text-right">
              {prevYear ? <DeltaCell curr={totalOf(currentYear)} prev={totalOf(prevYear)} /> : "—"}
            </td>
          </tr>
        </tbody>
      </table>
      </div>
    </div>
  );
}

/** Mini-trio de rectangles N-2 / N-1 / N pour une ligne (lecture visuelle rapide
 *  de la tendance sur 3 ans). Hauteur = part de la plus grande des 3 valeurs. */
function MiniYearBars({
  items, currentYear, prevYear, mode,
}: {
  items: { year: number; value: number }[];
  currentYear: number;
  prevYear: number | null;
  mode: Metric;
}) {
  const max = Math.max(1, ...items.map((i) => Math.abs(i.value)));
  return (
    <div className="flex items-end justify-center gap-2.5 h-12 w-full border-b border-border/40">
      {items.map((it) => {
        const h = (Math.abs(it.value) / max) * 100;
        const color = it.year === currentYear ? "bg-brand-500"
          : it.year === prevYear ? "bg-brand-500/55"
          : "bg-muted-foreground/35";
        return (
          <div key={it.year} className="flex-1 max-w-[26px] h-full flex flex-col items-center justify-end"
            title={`${it.year} : ${it.value === 0 ? "—" : formatValue(it.value, mode)}`}>
            <div
              className={`w-full rounded-t-[3px] ${color}`}
              style={{ height: `${Math.max(h, it.value > 0 ? 8 : 3)}%`, opacity: it.value > 0 ? 1 : 0.35 }}
            />
          </div>
        );
      })}
    </div>
  );
}

function DeltaCell({ curr, prev }: { curr: number; prev: number }) {
  if (prev === 0 && curr === 0) return <span className="text-muted-foreground">—</span>;
  if (prev === 0) return <span className="text-emerald-600 dark:text-emerald-400 font-semibold text-[10.5px]">nouveau</span>;
  const pct = Math.round((curr - prev) / Math.abs(prev) * 100);
  // Direction calée sur le % ARRONDI (dead-band) : un +0,4 % qui s'arrondit à 0
  // affiche un état neutre, pas une flèche verte trompeuse.
  const Icon = pct === 0 ? Minus : pct > 0 ? ArrowUp : ArrowDown;
  const color = pct === 0 ? "text-muted-foreground"
              : pct > 0   ? "text-emerald-600 dark:text-emerald-400"
              :             "text-rose-500 dark:text-rose-400";
  return (
    <span className={`inline-flex items-center gap-0.5 font-semibold ${color}`}>
      <Icon className="h-2.5 w-2.5" strokeWidth={2.5} />
      {pct === 0 ? "0%" : `${pct > 0 ? "+" : ""}${pct}%`}
    </span>
  );
}

/* ─────────────────────────────────────────────────────────────────
   Drilldown drawer — clic cellule mois → détail top clients / items / daily.
   Plein écran, position absolue, fermable via X ou ESC.
   ───────────────────────────────────────────────────────────────── */

interface MonthDrillPayload {
  year: number;
  month: number;
  totalCa: number;
  totalMargin: number;
  totalWeightKg: number;
  invoicesCount: number;
  topClients: { cardCode: string; cardName: string | null; ca: number; weightKg: number; invoices: number }[];
  topFamilies: { key: string; label: string; quantity: number; ca: number; weightKg: number }[];
  daily: { day: number; ca: number; weightKg: number }[];
}

function MonthDrilldownDrawer({
  year, month, mode, segment, viewAs = null, onClose,
}: { year: number; month: number; mode: "ca" | "weight"; segment: Segment; viewAs?: string | null; onClose: () => void }) {
  const [data, setData] = useState<MonthDrillPayload | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    fetch(`/api/pilotage/annual/month?year=${year}&month=${month}&segment=${segment}${viewAs ? `&as=${encodeURIComponent(viewAs)}` : ""}`, { cache: "no-store" })
      .then((r) => r.ok ? r.json() : null)
      .then((j) => setData(j))
      .finally(() => setLoading(false));
  }, [year, month, segment, viewAs]);

  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose]);

  // A3 — distribution jour par jour du mois, mais étiquetée par INITIALE du
  // jour de la semaine (L M M J V S D) plutôt qu'un index 1→31 brut.
  const daily = data?.daily ?? [];
  const valOfDay = (d: { ca: number; weightKg: number }) => (mode === "ca" ? d.ca : d.weightKg);
  const maxDaily = Math.max(...daily.map(valOfDay), 1);
  const peakDay = daily.reduce((best, d) => (valOfDay(d) > valOfDay(best) ? d : best), { day: 0, ca: -1, weightKg: -1 });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-6" onClick={onClose}>
      <div
        className="bg-card border border-border rounded-xl shadow-2xl w-full max-w-5xl max-h-[88vh] overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="shrink-0 flex items-center justify-between px-5 py-3 border-b border-border">
          <div className="flex items-baseline gap-3">
            <p className="text-[10px] uppercase tracking-[0.18em] font-bold text-muted-foreground">Drill-in mois</p>
            <h2 className="text-[20px] font-semibold tracking-tight text-foreground">
              {MOIS_FR[month]} {year}
            </h2>
            {data && (
              <span className="text-[12px] text-muted-foreground tnum">
                · {formatEuro(data.totalCa, true)} CA · {formatWeight(data.totalWeightKg)} · {data.invoicesCount} factures
              </span>
            )}
          </div>
          <button onClick={onClose} className="p-1.5 hover:bg-secondary rounded-md text-muted-foreground">
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="flex-1 overflow-auto p-5 grid grid-cols-12 gap-4">
          {loading && <p className="col-span-12 text-center text-muted-foreground text-[13px]">Chargement…</p>}
          {!loading && data && (
            <>
              {/* Distribution jour par jour, labels = initiale du jour (L M M J V S D) */}
              <section className="col-span-12 bg-secondary/30 rounded-lg p-3">
                <h3 className="text-[10.5px] uppercase tracking-[0.14em] font-semibold text-muted-foreground mb-2">
                  Distribution {mode === "ca" ? "CA" : "Poids"} par jour
                </h3>
                <div className="flex items-stretch gap-[3px]">
                  {daily.map((d) => {
                    const v = valOfDay(d);
                    const h = (v / maxDaily) * 100;
                    const dow = new Date(year, month, d.day).getDay(); // 0=dim..6=sam
                    const weekend = dow === 0 || dow === 6;
                    const isPeak = d.day === peakDay.day && v > 0;
                    return (
                      <div key={d.day} className="flex-1 flex flex-col items-center min-w-0"
                        title={`${WEEKDAYS_LONG_FR[dow === 0 ? 6 : dow - 1]} ${d.day} ${MOIS_FR[month]} : ${formatValue(v, mode)}`}>
                        <div className="h-24 w-full flex items-end">
                          <div
                            className={`w-full rounded-sm transition-colors ${
                              isPeak ? "bg-brand-500" : weekend ? "bg-brand-500/30 hover:bg-brand-500/50" : "bg-brand-500/60 hover:bg-brand-500/80"
                            }`}
                            style={{ height: `${Math.max(h, v > 0 ? 4 : 1)}%`, opacity: v > 0 ? 1 : 0.18 }}
                          />
                        </div>
                        <span className={`text-[8.5px] mt-1 leading-none ${weekend ? "text-muted-foreground/50" : "text-muted-foreground/80"} ${isPeak ? "text-foreground font-bold" : ""}`}>
                          {WEEKDAY_INITIAL[dow]}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </section>

              {/* Top clients */}
              <section className="col-span-7 bg-secondary/30 rounded-lg p-3">
                <h3 className="text-[10.5px] uppercase tracking-[0.14em] font-semibold text-muted-foreground mb-2">
                  Top 5 clients
                </h3>
                <ol className="space-y-1 text-[12px]">
                  {data.topClients.map((c, i) => (
                    <li key={c.cardCode} className="grid grid-cols-[18px_1fr_auto_auto] items-baseline gap-2">
                      <span className="text-muted-foreground/70 tnum text-right">{i + 1}</span>
                      <span className="font-medium text-foreground truncate">{c.cardName ?? c.cardCode}</span>
                      <span className="font-semibold tnum text-foreground tabular-nums whitespace-nowrap">
                        {formatValue(mode === "ca" ? c.ca : c.weightKg, mode)}
                      </span>
                      <span className="text-[10px] text-muted-foreground whitespace-nowrap">{c.invoices} fact.</span>
                    </li>
                  ))}
                  {data.topClients.length === 0 && (
                    <li className="text-muted-foreground italic">Aucun client ce mois.</li>
                  )}
                </ol>
              </section>

              {/* Top familles (regroupées) + donut de répartition */}
              <section className="col-span-5 bg-secondary/30 rounded-lg p-3">
                <h3 className="text-[10.5px] uppercase tracking-[0.14em] font-semibold text-muted-foreground mb-2">
                  Top familles {mode === "ca" ? "· CA" : "· Poids"}
                </h3>
                {data.topFamilies.length > 0 ? (
                  <Donut
                    size={108}
                    thickness={14}
                    centerValue={formatValue(
                      data.topFamilies.reduce((s, f) => s + (mode === "ca" ? f.ca : f.weightKg), 0), mode,
                    )}
                    centerLabel={mode === "ca" ? "CA" : "Poids"}
                    data={data.topFamilies.map((f) => ({
                      label: f.label,
                      value: Math.max(0, mode === "ca" ? f.ca : f.weightKg),
                    }))}
                    aria-label="Répartition du CA par famille d'article ce mois"
                  />
                ) : (
                  <p className="text-muted-foreground italic text-[12px]">Aucune famille ce mois.</p>
                )}
              </section>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────
   Header — pas de switch granularité (rapport pure-année).
   À la place : toggle mode CA HT / Poids.
   ───────────────────────────────────────────────────────────────── */
function Header({
  screen, period, mode, onMode, showModeToggle, view, onView, segment, onSegment, onRefresh,
}: {
  screen: string;
  period: string;
  mode: Metric;
  onMode: (m: Metric) => void;
  showModeToggle: boolean;
  view: Screen2View;
  onView: (v: Screen2View) => void;
  segment: Segment;
  onSegment: (s: Segment) => void;
  onRefresh: () => void;
}) {
  const [now, setNow] = useState<string>("");
  useEffect(() => {
    const tick = () => setNow(new Date().toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" }));
    tick();
    const id = setInterval(tick, 30_000);
    return () => clearInterval(id);
  }, []);

  return (
    <header className="shrink-0 flex items-center justify-between gap-4 pl-36 pr-2">
      <div className="flex items-baseline gap-3 min-w-0">
        <p className="text-[10.5px] uppercase tracking-[0.18em] font-bold text-muted-foreground shrink-0">
          {screen}
        </p>
        <h1 className="text-[15px] font-semibold tracking-tight text-foreground truncate">
          {period}
        </h1>
      </div>
      <div className="flex items-center gap-3">
        <ViewSwitch value={view} onChange={onView} />
        <span className="text-[11px] text-muted-foreground tnum">{now}</span>
        <SegmentToggle value={segment} onChange={onSegment} />
        {showModeToggle && <ModeToggle value={mode} onChange={onMode} />}
        <RefreshButton onClick={onRefresh} />
      </div>
    </header>
  );
}

function ViewSwitch({ value, onChange }: { value: Screen2View; onChange: (v: Screen2View) => void }) {
  const tabs: { id: Screen2View; label: string }[] = [
    { id: "matrix", label: "Matrice" },
    { id: "evolution", label: "Évolution" },
    { id: "events", label: "Événements" },
  ];
  return (
    <div className="inline-flex items-center gap-0.5 bg-secondary/60 p-0.5 rounded-md">
      {tabs.map((t) => (
        <button
          key={t.id}
          type="button"
          onClick={() => onChange(t.id)}
          aria-pressed={value === t.id}
          className={`px-2.5 h-7 text-[11.5px] font-semibold tracking-tight rounded transition-colors ${
            value === t.id ? "bg-primary text-primary-foreground shadow-[0_0_10px_rgba(250,204,21,0.45)]" : "text-muted-foreground hover:text-foreground"
          }`}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

/** Sélecteur de segment commercial — filtre tout le rapport (TOUT / GMS / CHR / EXPORT / RUNGIS). */
function SegmentToggle({ value, onChange }: { value: Segment; onChange: (s: Segment) => void }) {
  return (
    <div className="inline-flex items-center gap-0.5 bg-secondary/60 p-0.5 rounded-md">
      {SEGMENTS.map((s) => (
        <button
          key={s.id}
          type="button"
          onClick={() => onChange(s.id)}
          aria-pressed={value === s.id}
          className={`px-2.5 h-7 text-[11.5px] font-semibold tracking-tight rounded transition-colors ${
            value === s.id ? "bg-primary text-primary-foreground shadow-[0_0_10px_rgba(250,204,21,0.45)]" : "text-muted-foreground hover:text-foreground"
          }`}
        >
          {s.label}
        </button>
      ))}
    </div>
  );
}

function ModeToggle({ value, onChange }: { value: Metric; onChange: (m: Metric) => void }) {
  const opts: { id: Metric; label: string }[] = [
    { id: "ca", label: "CA HT" },
    { id: "weight", label: "Poids" },
    { id: "marginPct", label: "Marge %" },
  ];
  return (
    <div className="inline-flex items-center gap-0.5 bg-secondary/60 p-0.5 rounded-md">
      {opts.map((o) => (
        <button
          key={o.id}
          type="button"
          onClick={() => onChange(o.id)}
          aria-pressed={value === o.id}
          className={`px-2.5 h-7 text-[11.5px] font-semibold tracking-tight rounded transition-colors ${
            value === o.id ? "bg-primary text-primary-foreground shadow-[0_0_10px_rgba(250,204,21,0.45)]" : "text-muted-foreground hover:text-foreground"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
