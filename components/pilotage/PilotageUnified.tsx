"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import {
  ArrowLeft, Trophy, Maximize2, X, Home, AlertCircle,
  Users, Briefcase, Building2, Map as MapIcon, CalendarRange,
} from "lucide-react";
import { Tile, BigKpi, MiniKpi, RefreshButton, formatEuro, formatNum, formatPct } from "./bento";
import { GranularitySwitch } from "./GranularitySwitch";
import {
  useActivityData, useActivityWeekly, useAnnualData, useGeoData, useSharedGranularity,
  granularityLabel, granularityShortHint, type ActivityWeeklyPayload,
} from "./usePilotageData";
import { ClientsModal, SuppliersModal, CommerciauxModal } from "./pilotage-modals";
import { TrendArea, type TrendPoint } from "@/components/charts/TrendArea";
import { KpiStrip } from "@/components/accueil/KpiStrip";
import { SignalLoader } from "@/components/ui/page-loader";
import { isoWeekLabel } from "@/lib/iso-week";
import { grossMarginPct } from "@/lib/margin";
import { groupParisZones } from "@/components/charts/geoShared";
import type { Granularity } from "@/lib/pilotage";

/* Écrans complets réutilisés en OVERLAY plein écran (chargés au 1er clic —
   Screen3 embarque 2 cartes WebGL, on ne paie ce coût qu'à l'ouverture). */
const screenLoading = () => (
  <div className="h-screen w-screen flex items-center justify-center"><SignalLoader /></div>
);
const PilotageScreen2 = dynamic(() => import("./PilotageScreen2").then((m) => m.PilotageScreen2), { ssr: false, loading: screenLoading });
const PilotageScreen3 = dynamic(() => import("./PilotageScreen3").then((m) => m.PilotageScreen3), { ssr: false, loading: screenLoading });

const MOIS_1L = ["J", "F", "M", "A", "M", "J", "J", "A", "S", "O", "N", "D"];

function formatWeight(kg: number): string {
  if (Math.abs(kg) >= 1000) return `${(kg / 1000).toFixed(1)} t`;
  if (Math.abs(kg) >= 1) return `${Math.round(kg)} kg`;
  return "—";
}
/* Tendance hebdo N vs N-1 lissée — même logique que l'ex-écran 1. */
function movingAverage(vals: number[], win = 3): number[] {
  const half = Math.floor(win / 2);
  return vals.map((_, i) => {
    let sum = 0, n = 0;
    for (let k = i - half; k <= i + half; k++) if (k >= 0 && k < vals.length) { sum += vals[k]; n++; }
    return n > 0 ? sum / n : 0;
  });
}
function buildTrend(wk: ActivityWeeklyPayload | null, pick: (w: { volume: number; weightKg: number }) => number): TrendPoint[] {
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
  const labels: string[] = [], cur: number[] = [], prev: number[] = [];
  for (let w = 1; w <= upTo; w++) {
    labels.push(isoWeekLabel(w));
    cur.push(curMap.get(w) ?? 0);
    prev.push(prevMap.get(w) ?? 0);
  }
  const cs = movingAverage(cur, 3), ps = movingAverage(prev, 3);
  return labels.map((label, i) => ({ label, value: cs[i], compare: ps[i] }));
}

type Overlay = null | "clients" | "commerciaux" | "fournisseurs" | "annual" | "geo";

/**
 * PILOTAGE UNIFIÉ — les 3 anciens écrans (Commercial BL · Annuel comptable ·
 * Carte géo) COMPRESSÉS en un seul cockpit compact, sans slider.
 *
 * Principe : « survol = aperçu, clic = plein écran ».
 *   • Chaque tuile compacte montre l'essentiel ; le survol d'une ligne ouvre un
 *     popover de détail (CSS pur, zéro coût).
 *   • Le clic ouvre le PLEIN ÉCRAN : modales dédiées (clients, fournisseurs,
 *     commerciaux → détail des factures & commissions) ou les écrans complets
 *     conservés (rapport annuel = ex-écran 2, carte = ex-écran 3) en overlay.
 *
 * Disposition 12×8 (h-screen, zéro scroll) :
 *   ┌ CA HT BL (3×2) ┬ Marge (3×2) ┬ Cdes/Panier (3×2) ┬ Appels/Conv (3×2) ┐
 *   ├ Évolution hebdo N vs N-1 (7×3)      ┬ Matrice annuelle compacte (5×3) ┤
 *   ├ Top clients (4×3) ┬ Commerciaux (3×3) ┬ Fournisseurs (3×3) ┬ Géo (2×3)┘
 */
export function PilotageUnified({ viewAs = null }: { viewAs?: string | null } = {}) {
  const ALLOWED: Granularity[] = ["day", "week", "month"];
  const [g, setG] = useSharedGranularity("week", "leader");
  const safeG: Granularity = ALLOWED.includes(g) ? g : "month";
  const [metric, setMetric] = useState<"ca" | "weight">("ca");
  const isWeight = metric === "weight";
  const pick = (w: { volume: number; weightKg: number }) => (isWeight ? w.weightKg : w.volume);
  const fmtVal = (n: number) => (isWeight ? formatWeight(n) : formatEuro(n, true));

  const [nonce, setNonce] = useState(0);
  const { data, err } = useActivityData(safeG, viewAs, nonce);
  const { data: weekly } = useActivityWeekly(viewAs, nonce);
  const { data: annual } = useAnnualData("ALL", viewAs, nonce);
  const { data: geo } = useGeoData(viewAs, nonce);

  const [overlay, setOverlay] = useState<Overlay>(null);

  const loading = data === null && err === null;
  const ph = loading ? "…" : "—";
  const trend = useMemo(() => buildTrend(weekly, pick), [weekly, isWeight]); // eslint-disable-line react-hooks/exhaustive-deps
  const periodLabel = granularityLabel(safeG);
  const hint = granularityShortHint(safeG);

  const topZones = useMemo(() => {
    if (!geo) return [];
    return groupParisZones(geo.zones)
      .filter((z) => z.ca > 0)
      .sort((a, b) => b.ca - a.ca)
      .slice(0, 6);
  }, [geo]);

  const basketCurr = data ? (isWeight ? (data.curr.ordersCount > 0 ? data.curr.weightKg / data.curr.ordersCount : 0) : data.curr.avgBasket) : 0;
  const basketPrev = data ? (isWeight ? (data.prev.ordersCount > 0 ? data.prev.weightKg / data.prev.ordersCount : 0) : data.prev.avgBasket) : 0;

  return (
    <div className="relative h-screen w-screen overflow-hidden">
      {/* ── MOBILE : chiffres clés du jour (le bento 12×8 est illisible au doigt) ── */}
      <div className="md:hidden h-full overflow-y-auto px-4 py-4 space-y-4">
        <div className="flex items-center gap-2.5">
          <Link href="/accueil" aria-label="Accueil" className="inline-flex h-11 w-11 items-center justify-center rounded-xl border border-border text-foreground/70 shrink-0">
            <Home className="h-5 w-5" />
          </Link>
          <div className="min-w-0">
            <p className="kicker">Pilotage</p>
            <h1 className="text-[20px] font-semibold leading-none text-foreground">Chiffres clés du jour</h1>
          </div>
        </div>
        <KpiStrip />
        <div className="rounded-2xl border border-border bg-card p-4 text-[14px] leading-relaxed text-muted-foreground">
          📊 La vue complète — cockpit unifié, rapport annuel, commissions et carte —
          est optimisée pour <b className="text-foreground">grand écran</b>.
        </div>
      </div>

      {/* ── DESKTOP : cockpit unifié ── */}
      <div className="hidden md:flex h-full w-full flex-col p-3 gap-2.5">
        {/* Header — tout est intégré, plus rien ne flotte (fini le chevauchement). */}
        <header className="shrink-0 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <Link
              href="/console"
              aria-label="Retour au site"
              title="Retour au site"
              className="inline-flex items-center gap-1.5 h-8 pl-2 pr-3 rounded-full bg-card border border-border text-[11px] font-semibold text-foreground/80 hover:text-foreground transition-colors shrink-0"
            >
              <ArrowLeft className="h-3.5 w-3.5" /> Retour
            </Link>
            <div className="flex items-baseline gap-3 min-w-0">
              <p className="text-[10.5px] uppercase tracking-[0.18em] font-bold text-muted-foreground shrink-0">
                Pilotage · Vue d&apos;ensemble
              </p>
              <h1 className="text-[15px] font-semibold tracking-tight text-foreground truncate">{periodLabel}</h1>
            </div>
          </div>
          <div className="flex items-center gap-2.5 shrink-0">
            <MetricToggle value={metric} onChange={setMetric} />
            <GranularitySwitch value={safeG} onChange={setG} allowed={ALLOWED} />
            <Clock />
            <Link
              href="/dashboard/magasins"
              title="Palmarès des magasins — rentabilité par client"
              className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md bg-secondary/60 text-[11.5px] font-semibold text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
            >
              <Trophy className="h-3.5 w-3.5 text-brand-500" /> Palmarès
            </Link>
            <RefreshButton onClick={() => setNonce((n) => n + 1)} />
          </div>
        </header>

        {err && (
          <div className="flex-1 grid place-items-center">
            <div className="flex flex-col items-center gap-3 text-center">
              <p className="text-[13px] text-rose-400">Erreur de chargement : {err}</p>
              <button
                type="button"
                onClick={() => setNonce((n) => n + 1)}
                className="px-3 h-8 text-[12px] font-semibold rounded-md bg-secondary/60 text-foreground hover:bg-secondary transition-colors"
              >
                Réessayer
              </button>
            </div>
          </div>
        )}

        {!err && (
        <main
          className="flex-1 grid gap-2 min-h-0"
          style={{ gridTemplateColumns: "repeat(12, minmax(0, 1fr))", gridTemplateRows: "repeat(8, minmax(0, 1fr))" }}
        >
          {/* ── Rang 1 : KPI (survol = détail N-1) ── */}
          <Tile colSpan={3} rowSpan={2} accent="brand" className="!overflow-visible">
            <Pop
              content={data && (
                <>
                  <PopRow k={`N-1 (${hint.toLowerCase()})`} v={fmtVal(isWeight ? data.prev.weightKg : data.prev.volume)} />
                  <PopRow k={isWeight ? "CA HT équivalent" : "Poids équivalent"} v={isWeight ? formatEuro(data.curr.volume, true) : formatWeight(data.curr.weightKg)} />
                  <PopRow k="Clients actifs" v={formatNum(data.curr.activeClients)} />
                </>
              )}
            >
              <BigKpi
                label={isWeight ? "Volume BL (kg)" : "CA HT BL"}
                value={data ? fmtVal(isWeight ? data.curr.weightKg : data.curr.volume) : ph}
                curr={data ? pick(data.curr) : 0}
                prev={data ? pick(data.prev) : 0}
                hint={hint}
                format={data ? fmtVal : undefined}
                animateOnMount
              />
            </Pop>
          </Tile>

          <Tile colSpan={3} rowSpan={2} accent="emerald" className="!overflow-visible">
            <Pop
              content={data && (
                <>
                  <PopRow k="Marge N-1" v={formatEuro(data.prev.margin, true)} />
                  <PopRow k="Marge % N-1" v={formatPct(data.prev.marginPct)} />
                  <PopRow k="Couverture coûts EM" v={formatPct(data.curr.marginCoverage)} />
                </>
              )}
            >
              <div className="h-full flex flex-col">
                <BigKpi
                  label="Marge BL (ligne à ligne)"
                  value={data ? formatEuro(data.curr.margin, true) : ph}
                  curr={data?.curr.margin ?? 0}
                  prev={data?.prev.margin ?? 0}
                  hint={data ? `${formatPct(data.curr.marginPct)} de marge` : undefined}
                  format={data ? (n) => formatEuro(n, true) : undefined}
                  animateOnMount
                />
                {data && data.curr.marginCoverage < 95 && (
                  <p className="text-[10px] text-amber-600 dark:text-amber-400 mt-1 inline-flex items-center gap-1">
                    <AlertCircle className="h-3 w-3 shrink-0" />
                    {formatPct(data.curr.marginCoverage)} des lignes costées
                  </p>
                )}
              </div>
            </Pop>
          </Tile>

          <Tile colSpan={3} rowSpan={2}>
            <div className="h-full grid grid-rows-2 gap-1.5">
              <MiniKpi label="Cdes BL" value={data ? formatNum(data.curr.ordersCount) : ph}
                curr={data?.curr.ordersCount ?? 0} prev={data?.prev.ordersCount ?? 0}
                format={data ? formatNum : undefined} animateOnMount />
              <MiniKpi label={isWeight ? "Panier moyen (kg)" : "Panier moyen"}
                value={data ? (isWeight ? formatWeight(basketCurr) : formatEuro(basketCurr)) : ph}
                curr={basketCurr} prev={basketPrev}
                format={data ? (isWeight ? formatWeight : (n) => formatEuro(n)) : undefined} animateOnMount />
            </div>
          </Tile>

          <Tile colSpan={3} rowSpan={2}>
            <div className="h-full grid grid-rows-2 gap-1.5">
              <MiniKpi label="Appels CRM" value={data ? formatNum(data.crm.appels) : ph}
                curr={data?.crm.appels ?? 0} prev={data?.crmPrev.appels ?? 0}
                format={data ? formatNum : undefined} animateOnMount />
              <MiniKpi label="Taux conversion" value={data ? formatPct(data.crm.tauxConv) : ph}
                curr={data?.crm.tauxConv ?? 0} prev={data?.crmPrev.tauxConv ?? 0}
                format={data ? formatPct : undefined} animateOnMount />
            </div>
          </Tile>

          {/* ── Rang 2 : évolution + matrice annuelle compacte ── */}
          <Tile colSpan={7} rowSpan={3} title={`Évolution ${isWeight ? "volume kg" : "CA HT"} BL · hebdo (N vs N-1)`} accent="brand">
            {trend.length > 1 ? (
              <TrendArea data={trend} tone="brand" height="100%" className="h-full" format={fmtVal}
                currentLabel="N" compareLabel="N-1"
                aria-label="Évolution BL hebdomadaire, année courante vs précédente" />
            ) : (
              <div className="h-full flex items-center justify-center text-[12px] text-muted-foreground">Série indisponible.</div>
            )}
          </Tile>

          <ClickTile colSpan={5} rowSpan={3} icon={CalendarRange} accent="violet"
            title="Rapport annuel · CA facturé"
            hintOpen="matrice, évolutions, drill-in mois"
            onOpen={() => setOverlay("annual")}
          >
            <CompactMatrix matrix={annual?.matrix ?? []} />
          </ClickTile>

          {/* ── Rang 3 : les mondes — clic = plein écran ── */}
          <ClickTile colSpan={4} rowSpan={3} icon={Users} accent="brand"
            title={`Top clients · ${isWeight ? "Volume" : "CA HT"} × appels`}
            hintOpen="tous les magasins, marges & transport"
            onOpen={() => setOverlay("clients")}
          >
            <ol className="h-full flex flex-col gap-0.5 overflow-hidden">
              {(data?.clients ?? []).slice(0, 7).map((c, i) => (
                <PopLi key={c.cardCode}
                  rank={i + 1}
                  name={c.cardName ?? c.cardCode}
                  value={fmtVal(isWeight ? c.weightKg : c.volume)}
                  bar={(isWeight ? c.weightKg : c.volume) / Math.max(...(data?.clients ?? []).map((x) => (isWeight ? x.weightKg : x.volume)), 1)}
                  tone="bg-brand-500/15"
                  pop={
                    <>
                      <PopRow k="CA période" v={formatEuro(c.volume, true)} />
                      <PopRow k="Poids" v={formatWeight(c.weightKg)} />
                      <PopRow k="Commandes BL" v={formatNum(c.orders)} />
                      <PopRow k="Appels télévente" v={formatNum(c.crmCalls)} />
                      <p className="mt-1 text-[10px] text-brand-400">Clic : détail de tous les magasins →</p>
                    </>
                  }
                  sub={`${formatNum(c.orders)} BL · ${formatNum(c.crmCalls)} app.`}
                />
              ))}
              {loading && <EmptyHint text="Chargement…" />}
              {!loading && (data?.clients ?? []).length === 0 && <EmptyHint text="Aucune vente sur la période." />}
            </ol>
          </ClickTile>

          <ClickTile colSpan={3} rowSpan={3} icon={Briefcase} accent="violet"
            title="Commerciaux"
            hintOpen="équipe, primes & factures"
            onOpen={() => setOverlay("commerciaux")}
          >
            <ol className="h-full flex flex-col gap-0.5 overflow-hidden">
              {(data?.salespersons ?? []).slice(0, 7).map((s, i) => (
                <PopLi key={s.slpName}
                  rank={i + 1}
                  name={s.slpName}
                  value={fmtVal(isWeight ? s.weightKg : s.volume)}
                  bar={(isWeight ? s.weightKg : s.volume) / Math.max(...(data?.salespersons ?? []).map((x) => (isWeight ? x.weightKg : x.volume)), 1)}
                  tone="bg-violet-500/15"
                  pop={
                    <>
                      <PopRow k="CA période" v={formatEuro(s.volume, true)} />
                      <PopRow k="Poids" v={formatWeight(s.weightKg)} />
                      <PopRow k="Clients actifs" v={formatNum(s.activeClients)} />
                      <PopRow k="Commandes BL" v={formatNum(s.orders)} />
                      <p className="mt-1 text-[10px] text-violet-300">Clic : primes & détail des factures →</p>
                    </>
                  }
                  sub={`${s.activeClients} cl. · ${s.orders} BL`}
                />
              ))}
              {loading && <EmptyHint text="Chargement…" />}
              {!loading && (data?.salespersons ?? []).length === 0 && (
                <EmptyHint text="Vue transverse réservée à la direction — clic pour votre détail." />
              )}
            </ol>
          </ClickTile>

          <ClickTile colSpan={3} rowSpan={3} icon={Building2} accent="amber"
            title={`Top fournisseurs · ${annual?.currentYear ?? "N"}`}
            hintOpen="achats nets 12 mois"
            onOpen={() => setOverlay("fournisseurs")}
          >
            <ol className="h-full flex flex-col gap-0.5 overflow-hidden">
              {(annual?.suppliers ?? []).slice(0, 7).map((s, i) => (
                <PopLi key={s.cardCode}
                  rank={i + 1}
                  name={s.cardName ?? s.cardCode}
                  value={formatEuro(s.totalIn, true)}
                  bar={s.totalIn / Math.max(...(annual?.suppliers ?? []).map((x) => x.totalIn), 1)}
                  tone="bg-amber-500/15"
                  pop={
                    <>
                      <PopRow k="Achats nets HT" v={formatEuro(s.totalIn, true)} />
                      <PopRow k="Entrées marchandises" v={formatNum(s.pdnCount)} />
                      <PopRow k="Poids" v={formatWeight(s.weightKg)} />
                      <p className="mt-1 text-[10px] text-amber-300">Clic : détail des achats →</p>
                    </>
                  }
                  sub={`${s.pdnCount} EM`}
                />
              ))}
              {annual === null && <EmptyHint text="Chargement…" />}
              {annual !== null && (annual.suppliers ?? []).length === 0 && (
                <EmptyHint text="Achats réservés à la direction." />
              )}
            </ol>
          </ClickTile>

          <ClickTile colSpan={2} rowSpan={3} icon={MapIcon} accent="sky"
            title="Zones · 12 mois"
            hintOpen="carte plein écran"
            onOpen={() => setOverlay("geo")}
          >
            <ol className="h-full flex flex-col gap-0.5 overflow-hidden">
              {topZones.map((z, i) => (
                <PopLi key={z.id}
                  rank={i + 1}
                  name={z.name}
                  value={formatEuro(z.ca, true)}
                  bar={z.ca / Math.max(...topZones.map((x) => x.ca), 1)}
                  tone="bg-sky-500/15"
                  compact
                  pop={
                    <>
                      <PopRow k="CA facturé" v={formatEuro(z.ca, true)} />
                      <PopRow k="Marge" v={formatEuro(z.margin, true)} />
                      <PopRow k="Poids" v={formatWeight(z.weightKg)} />
                      <PopRow k="BL · clients" v={`${formatNum(z.docs)} · ${formatNum(z.clients)}`} />
                      <p className="mt-1 text-[10px] text-sky-300">Clic : carte plein écran →</p>
                    </>
                  }
                />
              ))}
              {geo === null && <EmptyHint text="Chargement…" />}
              {geo !== null && topZones.length === 0 && <EmptyHint text="Aucune zone facturée." />}
            </ol>
          </ClickTile>
        </main>
        )}
      </div>

      {/* Bannière « voir comme » */}
      {viewAs && (
        <div className="absolute top-2.5 left-1/2 -translate-x-1/2 z-40 inline-flex items-center gap-2 h-8 pl-3 pr-1.5 rounded-full bg-violet-600/95 backdrop-blur-md shadow-modal text-[11.5px] font-semibold text-white">
          Vue de&nbsp;<span className="font-bold">{viewAs}</span>&nbsp;· lecture seule
          <Link href="/dashboard" className="ml-1 inline-flex items-center gap-1 h-6 px-2 rounded-full bg-white/15 hover:bg-white/25 transition-colors">
            <X className="h-3 w-3" /> Quitter
          </Link>
        </div>
      )}

      {/* ── Plein écran : modales de données ── */}
      {overlay === "clients" && <ClientsModal onClose={() => setOverlay(null)} />}
      {overlay === "fournisseurs" && <SuppliersModal onClose={() => setOverlay(null)} />}
      {overlay === "commerciaux" && <CommerciauxModal onClose={() => setOverlay(null)} />}

      {/* ── Plein écran : les écrans complets conservés (annuel & carte) ── */}
      {overlay === "annual" && (
        <ScreenOverlay onClose={() => setOverlay(null)}>
          <PilotageScreen2 viewAs={viewAs} />
        </ScreenOverlay>
      )}
      {overlay === "geo" && (
        <ScreenOverlay onClose={() => setOverlay(null)}>
          <PilotageScreen3 viewAs={viewAs} />
        </ScreenOverlay>
      )}
    </div>
  );
}

/* ───────────────────────── Briques locales ───────────────────────── */

function Clock() {
  const [now, setNow] = useState("");
  useEffect(() => {
    const tick = () => setNow(new Date().toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" }));
    tick();
    const id = setInterval(tick, 30_000);
    return () => clearInterval(id);
  }, []);
  return <span className="text-[11px] text-muted-foreground tnum">{now}</span>;
}

function MetricToggle({ value, onChange }: { value: "ca" | "weight"; onChange: (m: "ca" | "weight") => void }) {
  return (
    <div className="inline-flex items-center gap-0.5 bg-secondary/60 p-0.5 rounded-md">
      {(["ca", "weight"] as const).map((m) => (
        <button key={m} type="button" onClick={() => onChange(m)} aria-pressed={value === m}
          className={`px-2.5 h-7 text-[11.5px] font-semibold tracking-tight rounded transition-colors ${
            value === m ? "bg-primary text-primary-foreground shadow-[0_0_10px_rgba(250,204,21,0.45)]" : "text-muted-foreground hover:text-foreground"
          }`}
        >
          {m === "ca" ? "CA HT" : "Volume"}
        </button>
      ))}
    </div>
  );
}

/** Tuile CLIQUABLE — en-tête avec icône + affordance « plein écran », tout le
 *  corps est un bouton. Le survol des lignes internes garde ses popovers. */
function ClickTile({
  colSpan, rowSpan, icon: Icon, accent, title, hintOpen, onOpen, children,
}: {
  colSpan: number; rowSpan: number;
  icon: typeof Users;
  accent: "brand" | "emerald" | "rose" | "violet" | "amber" | "sky";
  title: string;
  hintOpen: string;
  onOpen: () => void;
  children: React.ReactNode;
}) {
  const accentBorder = {
    brand: "border-l-brand-500", emerald: "border-l-emerald-500", rose: "border-l-rose-500",
    violet: "border-l-violet-500", amber: "border-l-amber-500", sky: "border-l-sky-500",
  }[accent];
  return (
    <section
      className={`relative bg-card border border-border border-l-4 ${accentBorder} rounded-xl overflow-visible flex flex-col p-4 group/tile cursor-pointer hover:border-brand-500/40 transition-colors`}
      style={{ gridColumn: `span ${colSpan} / span ${colSpan}`, gridRow: `span ${rowSpan} / span ${rowSpan}` }}
      onClick={onOpen}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onOpen(); } }}
      aria-label={`${title} — ouvrir en plein écran (${hintOpen})`}
    >
      <div className="flex items-center justify-between gap-2 mb-2 shrink-0">
        <h3 className="text-[10.5px] uppercase tracking-[0.14em] font-semibold text-muted-foreground inline-flex items-center gap-1.5 min-w-0">
          <Icon className="h-3.5 w-3.5 shrink-0" /> <span className="truncate">{title}</span>
        </h3>
        <span className="inline-flex items-center gap-1 text-[9.5px] font-semibold text-muted-foreground/60 group-hover/tile:text-brand-400 transition-colors whitespace-nowrap">
          <Maximize2 className="h-3 w-3" />
          <span className="hidden xl:inline">{hintOpen}</span>
        </span>
      </div>
      <div className="relative flex-1 min-h-0">{children}</div>
    </section>
  );
}

/** Popover de survol — CSS pur (invisible → visible), zéro listener. */
function Pop({ children, content, up }: { children: React.ReactNode; content: React.ReactNode; up?: boolean }) {
  return (
    <div className="relative h-full group/pop">
      {children}
      {content && (
        <div className={`pointer-events-none invisible opacity-0 group-hover/pop:visible group-hover/pop:opacity-100 transition-opacity duration-150 absolute ${up ? "bottom-full mb-1.5" : "top-full mt-1.5"} left-0 z-40 w-56 rounded-lg border border-border bg-popover shadow-modal p-2.5`}>
          {content}
        </div>
      )}
    </div>
  );
}

function PopRow({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 text-[11px] leading-relaxed">
      <span className="text-muted-foreground">{k}</span>
      <span className="font-semibold text-foreground tnum tabular-nums whitespace-nowrap">{v}</span>
    </div>
  );
}

/** Ligne de top-list avec barre + popover au survol.
 *
 *  Le popover est rendu en `position: fixed` (coordonnées mesurées au survol) :
 *  il ÉCHAPPE à l'overflow-hidden des listes/tuiles — au-dessus de la ligne,
 *  rabattu vers la gauche s'il déborde du viewport. */
function PopLi({
  rank, name, value, sub, bar, tone, pop, compact,
}: {
  rank: number; name: string; value: string; sub?: string;
  bar: number; tone: string; pop: React.ReactNode; compact?: boolean;
}) {
  const [at, setAt] = useState<{ left: number; bottom: number } | null>(null);
  const POP_W = 224; // w-56
  return (
    <li
      className={`relative grid ${compact ? "grid-cols-[14px_1fr]" : "grid-cols-[18px_1fr_auto]"} items-center gap-1.5 text-[12px] min-h-0`}
      onMouseEnter={(e) => {
        const r = e.currentTarget.getBoundingClientRect();
        setAt({
          left: Math.max(8, Math.min(r.left + 24, window.innerWidth - POP_W - 8)),
          bottom: window.innerHeight - r.top + 6,
        });
      }}
      onMouseLeave={() => setAt(null)}
    >
      <span className="text-muted-foreground/70 tnum text-right text-[10.5px]">{rank}</span>
      <div className="min-w-0 relative">
        <div className={`absolute inset-y-0 left-0 rounded-sm ${tone}`} style={{ width: `${Math.min(100, bar * 100)}%` }} />
        <div className="relative px-1.5 py-0.5 min-w-0 flex items-baseline justify-between gap-2">
          <span className="min-w-0">
            <span className="font-medium text-foreground truncate block leading-tight">{name}</span>
            {sub && !compact && <span className="text-[9.5px] text-muted-foreground truncate block leading-tight">{sub}</span>}
          </span>
          {compact && <span className="font-semibold tnum tabular-nums text-[11px] whitespace-nowrap">{value}</span>}
        </div>
      </div>
      {!compact && (
        <span className="font-semibold tnum text-foreground tabular-nums whitespace-nowrap text-[11.5px]">{value}</span>
      )}
      {at && (
        <div
          className="pointer-events-none fixed z-[55] w-56 rounded-lg border border-border bg-popover shadow-modal p-2.5"
          style={{ left: at.left, bottom: at.bottom }}
        >
          <p className="text-[11.5px] font-bold text-foreground truncate mb-1">{name}</p>
          {pop}
        </div>
      )}
    </li>
  );
}

function EmptyHint({ text }: { text: string }) {
  return <li className="text-[11.5px] text-muted-foreground py-2 list-none">{text}</li>;
}

const MOIS_LONG = ["Janvier", "Février", "Mars", "Avril", "Mai", "Juin", "Juillet", "Août", "Septembre", "Octobre", "Novembre", "Décembre"];
/** Styles des 3 années du comparatif (du plus ancien au plus récent). */
const YEAR_BAR = [
  { bar: "bg-slate-500/45", dot: "bg-slate-400", text: "text-slate-300" },      // N-2
  { bar: "bg-brand-500/45", dot: "bg-brand-500/60", text: "text-brand-300" },   // N-1
  { bar: "bg-brand-500", dot: "bg-brand-500", text: "text-brand-400" },         // N
];

/** Matrice annuelle VISUELLE — barres mensuelles comparées sur 3 ans
 *  (N en jaune vif, N-1 atténué, N-2 gris), totaux annuels en légende,
 *  détail du mois au survol. Le drill-in complet vit dans l'overlay. */
function CompactMatrix({ matrix }: { matrix: { year: number; months: { ca: number }[]; totalCa: number }[] }) {
  const years = useMemo(() => [...matrix].sort((a, b) => a.year - b.year).slice(-3), [matrix]);
  const [tip, setTip] = useState<{ m: number; left: number; bottom: number } | null>(null);
  const max = Math.max(1, ...years.flatMap((y) => y.months.map((m) => m.ca)));
  if (years.length === 0) {
    return <div className="h-full flex items-center justify-center text-[12px] text-muted-foreground">Chargement du rapport annuel…</div>;
  }
  const styleOf = (i: number) => YEAR_BAR[YEAR_BAR.length - years.length + i] ?? YEAR_BAR[0];
  return (
    <div className="h-full flex flex-col min-h-0">
      {/* Légende : année + total annuel (gros chiffres, couleur = barre) */}
      <div className="shrink-0 flex flex-wrap items-baseline gap-x-4 gap-y-0.5 mb-1.5">
        {years.map((y, i) => (
          <span key={y.year} className="inline-flex items-baseline gap-1.5">
            <span className={`h-2 w-2 rounded-[3px] self-center ${styleOf(i).dot}`} />
            <span className="text-[10px] font-semibold text-muted-foreground tnum">{y.year}</span>
            <span className={`text-[13px] font-bold tnum ${styleOf(i).text}`}>{formatEuro(y.totalCa, true)}</span>
          </span>
        ))}
      </div>
      {/* Barres groupées par mois — hauteur = CA du mois */}
      <div className="flex-1 min-h-0 flex items-end gap-[3px]">
        {MOIS_1L.map((_, m) => (
          <div
            key={m}
            className="flex-1 h-full flex items-end justify-center gap-[2px] rounded-sm hover:bg-secondary/40 transition-colors px-[1px]"
            onMouseEnter={(e) => {
              const r = e.currentTarget.getBoundingClientRect();
              setTip({
                m,
                left: Math.max(8, Math.min(r.left - 60, window.innerWidth - 190)),
                bottom: window.innerHeight - r.top + 6,
              });
            }}
            onMouseLeave={() => setTip(null)}
          >
            {years.map((y, i) => {
              const v = y.months[m]?.ca ?? 0;
              return (
                <div key={y.year} className="flex-1 max-w-[9px] h-full flex items-end">
                  <div
                    className={`w-full rounded-t-[2px] ${styleOf(i).bar}`}
                    style={{ height: v > 0 ? `${Math.max(3, (v / max) * 100)}%` : "0%" }}
                  />
                </div>
              );
            })}
          </div>
        ))}
      </div>
      {/* Libellés mois */}
      <div className="shrink-0 flex gap-[3px] mt-1">
        {MOIS_1L.map((lbl, m) => (
          <div key={m} className="flex-1 text-center text-[8.5px] text-muted-foreground">{lbl}</div>
        ))}
      </div>
      {/* Tooltip du mois survolé — N, N-1, N-2 + évolution */}
      {tip && (() => {
        const cur = years[years.length - 1]?.months[tip.m]?.ca ?? 0;
        const prev = years[years.length - 2]?.months[tip.m]?.ca ?? 0;
        const delta = cur > 0 && prev > 0 ? ((cur / prev - 1) * 100) : null;
        return (
          <div
            className="pointer-events-none fixed z-[55] w-44 rounded-lg border border-border bg-popover shadow-modal p-2.5"
            style={{ left: tip.left, bottom: tip.bottom }}
          >
            <p className="text-[11.5px] font-bold text-foreground mb-1">{MOIS_LONG[tip.m]}</p>
            {[...years].reverse().map((y, ri) => {
              const i = years.length - 1 - ri;
              const v = y.months[tip.m]?.ca ?? 0;
              return (
                <div key={y.year} className="flex items-baseline justify-between gap-3 text-[11px] leading-relaxed">
                  <span className="inline-flex items-center gap-1.5 text-muted-foreground">
                    <span className={`h-1.5 w-1.5 rounded-full ${styleOf(i).dot}`} />{y.year}
                  </span>
                  <span className="font-semibold text-foreground tnum tabular-nums">{v > 0 ? formatEuro(v, true) : "—"}</span>
                </div>
              );
            })}
            {delta != null && (
              <p className={`mt-1 text-[10px] font-semibold ${delta >= 0 ? "text-emerald-300" : "text-rose-300"}`}>
                {delta >= 0 ? "▲" : "▼"} {Math.abs(delta).toFixed(0)} % vs N-1
              </p>
            )}
          </div>
        );
      })()}
    </div>
  );
}

/** Overlay hébergeant un ÉCRAN COMPLET (ex-écran 2 ou 3) — fond opaque,
 *  bouton retour à l'emplacement réservé par le `pl-36` des headers d'écran. */
function ScreenOverlay({ onClose, children }: { onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 bg-background isolate">
      {children}
      <button
        type="button"
        onClick={onClose}
        aria-label="Retour au pilotage"
        title="Retour au pilotage"
        className="absolute left-3 top-2.5 z-[60] inline-flex items-center gap-1.5 h-8 pl-2 pr-3 rounded-full bg-background/85 backdrop-blur-md border border-border shadow-modal text-[11px] font-semibold text-foreground/80 hover:text-foreground hover:bg-background transition-colors"
      >
        <ArrowLeft className="h-3.5 w-3.5" /> Pilotage
      </button>
    </div>
  );
}
