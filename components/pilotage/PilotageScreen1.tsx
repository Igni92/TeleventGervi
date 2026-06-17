"use client";

import { useState, useEffect, useMemo } from "react";
import { AlertCircle } from "lucide-react";
import {
  Tile, BigKpi, MiniKpi, TopList, MixedTopList, RefreshButton,
  formatEuro, formatNum, formatPct,
} from "./bento";
import { GranularitySwitch } from "./GranularitySwitch";
import {
  useActivityData, useActivityWeekly, useSharedGranularity,
  granularityLabel, granularityShortHint, type ActivityWeeklyPayload,
} from "./usePilotageData";
import { TrendArea, type TrendPoint } from "@/components/charts/TrendArea";
import { isoWeekLabel } from "@/lib/iso-week";
import type { Granularity } from "@/lib/pilotage";

type WeekPick = (w: { volume: number; weightKg: number }) => number;

/** Sparkline BL : les ~16 dernières semaines de l'année ISO courante (métrique au choix). */
function buildSpark(wk: ActivityWeeklyPayload | null, pick: WeekPick): number[] {
  if (!wk) return [];
  return wk.weeks
    .filter((w) => w.isoYear === wk.currentIsoYear)
    .sort((a, b) => a.week - b.week)
    .map(pick)
    .slice(-16);
}

/** Moyenne glissante centrée (lissage) sur une fenêtre de `win` semaines. */
function movingAverage(vals: number[], win = 3): number[] {
  const half = Math.floor(win / 2);
  return vals.map((_, i) => {
    let sum = 0, n = 0;
    for (let k = i - half; k <= i + half; k++) {
      if (k >= 0 && k < vals.length) { sum += vals[k]; n++; }
    }
    return n > 0 ? sum / n : 0;
  });
}

/** Courbe BL hebdomadaire N vs N-1, alignée par n° de semaine ISO (métrique au choix).
 *  **Lissée** par moyenne glissante : on veut la tendance, pas les pics semaine à semaine. */
function buildTrend(wk: ActivityWeeklyPayload | null, pick: WeekPick): TrendPoint[] {
  if (!wk) return [];
  const curY = wk.currentIsoYear;
  const curMap = new Map<number, number>();
  const prevMap = new Map<number, number>();
  for (const w of wk.weeks) {
    if (w.isoYear === curY) curMap.set(w.week, pick(w));
    else if (w.isoYear === curY - 1) prevMap.set(w.week, pick(w));
  }
  let last = 0;
  for (const w of wk.weeks) if (w.isoYear === curY && w.week > last) last = w.week;
  const upTo = Math.max(1, last || wk.currentWeek);

  const labels: string[] = [];
  const cur: number[] = [];
  const prev: number[] = [];
  for (let w = 1; w <= upTo; w++) {
    labels.push(isoWeekLabel(w));
    cur.push(curMap.get(w) ?? 0);
    prev.push(prevMap.get(w) ?? 0);
  }
  const curSmooth = movingAverage(cur, 3);
  const prevSmooth = movingAverage(prev, 3);
  return labels.map((label, i) => ({ label, value: curSmooth[i], compare: prevSmooth[i] }));
}

/** Poids en kg/t lisible. */
function formatWeight(kg: number): string {
  if (Math.abs(kg) >= 1000) return `${(kg / 1000).toFixed(1)} t`;
  if (Math.abs(kg) >= 1) return `${Math.round(kg)} kg`;
  return "—";
}

/**
 * Écran 1 — Cockpit Activité commerciale (BL).
 *
 * Source = SapOrder (commandes / BL). NE PAS confondre avec le CA comptable
 * qui est sur l'écran 2 (Invoices). Le vocabulaire évite délibérément le mot
 * "CA" → on parle de "Volume facturable", "Activité", "Cdes BL".
 *
 * Granularité restreinte = Jour / Semaine / Mois (pas Année — pour l'année,
 * basculer sur Écran 2 = rapport annuel comptable).
 *
 * Marge BRUTE calculée ligne par ligne :
 *   Σ (lineTotal − quantity × coût d'entrée marchandise réel)  sur SapOrderLine
 * (coût EM réel issu des dernières entrées marchandise — lib/cogs.ts, JAMAIS le
 * lineCost/grossProfit SAP). Marge % rapportée au CA produit NET (lib/margin).
 * La couverture des lignes dont le coût EM est connu est affichée pour
 * transparence sur la qualité des données.
 *
 * Disposition 12×6 :
 *   ┌──────── Volume BL (8×3 héros) ────────┬─ Marge € (4×3) ──┐
 *   ├── Cdes BL · Appels CRM · Conv % · Panier ── 4 mini (3×1)─┤
 *   ├ Top clients mixte BL × Appels CRM (6×2)│ Top commerciaux ┤
 *   └────────────────────────────────────────┴─────────────────┘
 */
export function PilotageScreen1({ viewAs = null }: { viewAs?: string | null } = {}) {
  const ALLOWED: Granularity[] = ["day", "week", "month"];
  const [g, setG] = useSharedGranularity("week", "leader");
  // Si l'écran 2 broadcast "year", on force "month" côté écran 1.
  const safeG: Granularity = ALLOWED.includes(g) ? g : "month";
  // Toggle métrique : CA HT (€, = docTotal BL) ↔ Volume (kg, = qty × poids unitaire).
  const [metric, setMetric] = useState<"ca" | "weight">("ca");
  const isWeight = metric === "weight";
  const pick: WeekPick = (w) => (isWeight ? w.weightKg : w.volume);
  const fmtVal = (n: number) => (isWeight ? formatWeight(n) : formatEuro(n, true));

  const [refreshNonce, setRefreshNonce] = useState(0);
  const { data, err } = useActivityData(safeG, viewAs, refreshNonce);
  const { data: weekly } = useActivityWeekly(viewAs, refreshNonce);
  // 1er chargement : data pas encore arrivée et pas d'erreur → on montre un état
  // de chargement léger plutôt que des « — » qui ressemblent à des zéros.
  const loading = data === null && err === null;
  const phBig = loading ? "Chargement…" : "—"; // placeholder gros chiffres
  const phMini = loading ? "…" : "—";           // placeholder mini-KPI (compact)
  const spark = useMemo(() => buildSpark(weekly, pick), [weekly, isWeight]); // eslint-disable-line react-hooks/exhaustive-deps
  const trend = useMemo(() => buildTrend(weekly, pick), [weekly, isWeight]); // eslint-disable-line react-hooks/exhaustive-deps
  const periodLabel = granularityLabel(safeG);
  const hint = granularityShortHint(safeG);

  // Valeurs principales selon la métrique
  const heroCurr = data ? (isWeight ? data.curr.weightKg : data.curr.volume) : 0;
  const heroPrev = data ? (isWeight ? data.prev.weightKg : data.prev.volume) : 0;
  const basketCurr = data ? (isWeight ? (data.curr.ordersCount > 0 ? data.curr.weightKg / data.curr.ordersCount : 0) : data.curr.avgBasket) : 0;
  const basketPrev = data ? (isWeight ? (data.prev.ordersCount > 0 ? data.prev.weightKg / data.prev.ordersCount : 0) : data.prev.avgBasket) : 0;

  return (
    <div className="h-screen w-screen flex flex-col p-3 gap-3 overflow-hidden">
      <Header
        screen="Cockpit · Activité commerciale (BL)"
        period={periodLabel}
        g={safeG}
        onG={setG}
        allowed={ALLOWED}
        metric={metric}
        onMetric={setMetric}
        onRefresh={() => setRefreshNonce((n) => n + 1)}
      />

      {err && (
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

      {!err && (
      <main
        className="flex-1 grid gap-2 min-h-0"
        style={{ gridTemplateColumns: "repeat(12, minmax(0, 1fr))", gridTemplateRows: "repeat(6, minmax(0, 1fr))" }}
      >
        {/* Volume BL héros (8×3) */}
        <Tile colSpan={8} rowSpan={3} accent="brand">
          <BigKpi
            label={isWeight ? "Activité commerciale · volume BL (kg)" : "Activité commerciale · CA HT BL"}
            value={data ? fmtVal(heroCurr) : phBig}
            curr={heroCurr}
            prev={heroPrev}
            hint={hint}
            spark={spark.length > 1 ? spark : undefined}
            format={data ? fmtVal : undefined}
            animateOnMount
          />
        </Tile>

        {/* Marge € (4×3) avec indicateur qualité couverture */}
        <Tile colSpan={4} rowSpan={3} accent="emerald">
          <div className="h-full flex flex-col">
            <BigKpi
              label="Marge BL (calculée ligne par ligne)"
              value={data ? formatEuro(data.curr.margin, true) : phBig}
              curr={data?.curr.margin ?? 0}
              prev={data?.prev.margin ?? 0}
              hint={data ? `${formatPct(data.curr.marginPct)} de marge` : undefined}
              format={data ? (n) => formatEuro(n, true) : undefined}
            animateOnMount
            />
            {data && data.curr.marginCoverage < 95 && (
              <p className="text-[10px] text-amber-600 dark:text-amber-400 mt-1 inline-flex items-center gap-1">
                <AlertCircle className="h-3 w-3 shrink-0" />
                {formatPct(data.curr.marginCoverage)} des lignes ont un coût d’entrée connu
              </p>
            )}
          </div>
        </Tile>

        {/* Ligne mini-KPI mixtes — Cdes BL · Appels CRM · Taux conv · Panier */}
        <Tile colSpan={3} rowSpan={1}>
          <MiniKpi
            label="Cdes BL"
            value={data ? formatNum(data.curr.ordersCount) : phMini}
            curr={data?.curr.ordersCount ?? 0}
            prev={data?.prev.ordersCount ?? 0}
            format={data ? formatNum : undefined}
            animateOnMount
          />
        </Tile>
        <Tile colSpan={3} rowSpan={1}>
          <MiniKpi
            label="Appels CRM"
            value={data ? formatNum(data.crm.appels) : phMini}
            curr={data?.crm.appels ?? 0}
            prev={data?.crmPrev.appels ?? 0}
            format={data ? formatNum : undefined}
            animateOnMount
          />
        </Tile>
        <Tile colSpan={3} rowSpan={1}>
          <MiniKpi
            label="Taux conversion CRM"
            value={data ? formatPct(data.crm.tauxConv) : phMini}
            curr={data?.crm.tauxConv ?? 0}
            prev={data?.crmPrev.tauxConv ?? 0}
            format={data ? formatPct : undefined}
            animateOnMount
          />
        </Tile>
        <Tile colSpan={3} rowSpan={1}>
          <MiniKpi
            label={isWeight ? "Panier moyen BL (kg)" : "Panier moyen BL"}
            value={data ? (isWeight ? formatWeight(basketCurr) : formatEuro(basketCurr)) : phMini}
            curr={basketCurr}
            prev={basketPrev}
            format={data ? (isWeight ? formatWeight : (n) => formatEuro(n)) : undefined}
            animateOnMount
          />
        </Tile>

        {/* Top clients mixte BL + # appels CRM (5×2) */}
        <Tile colSpan={5} rowSpan={2} title={`Top clients · ${isWeight ? "Volume kg" : "CA HT"} × Appels télévente`} accent="brand">
          <MixedTopList
            items={(data?.clients ?? []).slice(0, 6).map((c) => ({
              name: c.cardName ?? c.cardCode,
              value: isWeight ? c.weightKg : c.volume,
              secondary: c.crmCalls,
            }))}
            fmtPrimary={(v) => fmtVal(v)}
            primaryLabel={isWeight ? "Volume" : "CA"}
            secondaryLabel="Appels"
          />
        </Tile>

        {/* Top commerciaux BL (4×2) */}
        <Tile colSpan={4} rowSpan={2} title={`Top commerciaux · ${isWeight ? "Volume kg" : "CA HT"} BL`} accent="violet">
          <TopList
            items={(data?.salespersons ?? []).slice(0, 6).map((s) => ({
              name: s.slpName,
              value: isWeight ? s.weightKg : s.volume,
              sub: `${s.activeClients} clients · ${s.orders} BL`,
            }))}
            fmt={isWeight ? formatWeight : undefined}
          />
        </Tile>

        {/* Évolution BL hebdo N vs N-1 (3×2) */}
        <Tile colSpan={3} rowSpan={2} title={`Évolution ${isWeight ? "volume kg" : "CA HT"} BL · hebdo (N vs N-1)`} accent="brand">
          {trend.length > 1 ? (
            <TrendArea
              data={trend}
              tone="brand"
              height="100%"
              className="h-full"
              format={fmtVal}
              currentLabel="N"
              compareLabel="N-1"
              aria-label="Évolution BL hebdomadaire, année courante vs précédente, par numéro de semaine ISO"
            />
          ) : (
            <div className="h-full flex items-center justify-center text-[12px] text-muted-foreground">
              Série indisponible.
            </div>
          )}
        </Tile>
      </main>
      )}
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────
   Header — kicker + période + switch granularité (restreint) + lien sister.
   ───────────────────────────────────────────────────────────────── */
function Header({
  screen, period, g, onG, allowed, metric, onMetric, onRefresh,
}: {
  screen: string;
  period: string;
  g: Granularity;
  onG: (g: Granularity) => void;
  allowed: Granularity[];
  metric: "ca" | "weight";
  onMetric: (m: "ca" | "weight") => void;
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
        <MetricToggle value={metric} onChange={onMetric} />
        <span className="text-[11px] text-muted-foreground tnum">{now}</span>
        <GranularitySwitch value={g} onChange={onG} allowed={allowed} />
        <RefreshButton onClick={onRefresh} />
      </div>
    </header>
  );
}

/** Toggle CA HT (€) / Volume (kg) — même langage visuel que l'écran 2. */
function MetricToggle({ value, onChange }: { value: "ca" | "weight"; onChange: (m: "ca" | "weight") => void }) {
  return (
    <div className="inline-flex items-center gap-0.5 bg-secondary/60 p-0.5 rounded-md">
      <button
        type="button"
        onClick={() => onChange("ca")}
        aria-pressed={value === "ca"}
        className={`px-2.5 h-7 text-[11.5px] font-semibold tracking-tight rounded transition-colors ${
          value === "ca" ? "bg-primary text-primary-foreground shadow-[0_0_10px_rgba(250,204,21,0.45)]" : "text-muted-foreground hover:text-foreground"
        }`}
      >
        CA HT
      </button>
      <button
        type="button"
        onClick={() => onChange("weight")}
        aria-pressed={value === "weight"}
        className={`px-2.5 h-7 text-[11.5px] font-semibold tracking-tight rounded transition-colors ${
          value === "weight" ? "bg-primary text-primary-foreground shadow-[0_0_10px_rgba(250,204,21,0.45)]" : "text-muted-foreground hover:text-foreground"
        }`}
      >
        Volume
      </button>
    </div>
  );
}
