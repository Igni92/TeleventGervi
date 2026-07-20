"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft, Trophy, Truck, Gem, Flame, TriangleAlert,
  Coins, RefreshCw, Info, ArrowUpDown, ChevronDown,
} from "lucide-react";
import { formatEuro, formatNum } from "./bento";
import { SEGMENTS, type Segment, type ClientSegment } from "@/lib/segments";
import { SignalLoader } from "@/components/ui/page-loader";

/* ───────────────────────── Types (miroir de /api/pilotage/stores) ───────── */

interface StoreRow {
  cardCode: string;
  cardName: string | null;
  segment: ClientSegment | null;
  delivered: boolean;
  ca: number;
  caProductNet: number;
  invoices: number;
  weightKg: number;
  marginGross: number;
  marginGrossPct: number;
  transportCost: number;
  transportPctCa: number;
  transportPctMargin: number | null;
  marginNet: number;
  marginNetPct: number;
}

interface StoresPayload {
  period: { start: string; end: string };
  segment: Segment;
  prixPositionPerKg: number;
  /** Direct : coût PAR POSITION (annuel ÷ livraisons), appliqué par facture. */
  costPerDelivery: number;
  transportConfigured: boolean;
  nbStores: number;
  totals: {
    ca: number; caProductNet: number; weightKg: number; marginGross: number;
    transportCost: number; marginNet: number; marginGrossPct: number;
    marginNetPct: number; transportPctMargin: number | null;
  };
  stores: StoreRow[];
}

/* ───────────────────────── Formatage ────────────────────────────────────── */

const fmtEur = (v: number) => formatEuro(v);
const fmtEurC = (v: number) => formatEuro(v, true);
const fmtPct = (v: number) => `${v.toFixed(1)} %`;
const fmtWeight = (v: number) => (v >= 1000 ? `${(v / 1000).toFixed(1)} t` : `${formatNum(v)} kg`);
const fmtPerKg = (v: number) => `${v.toLocaleString("fr-FR", { minimumFractionDigits: 3, maximumFractionDigits: 3 })} €/kg`;

/* Couleur de segment — cohérente avec les accents bento (sky/emerald/violet/amber). */
const SEG_TONE: Record<ClientSegment, { dot: string; text: string }> = {
  GMS:       { dot: "bg-sky-400",     text: "text-sky-300" },
  CHR:       { dot: "bg-emerald-400", text: "text-emerald-300" },
  EXPORT:    { dot: "bg-violet-400",  text: "text-violet-300" },
  RUNGIS:    { dot: "bg-amber-400",   text: "text-amber-300" },
  MIN_RUNGIS:{ dot: "bg-amber-400",   text: "text-amber-300" },
};
function segLabel(s: ClientSegment | null): string {
  return s ? (SEGMENTS.find((x) => x.id === s)?.label ?? s) : "—";
}

const shortName = (n: string | null, code: string) => (n && n.trim() ? n : code);

/* ───────────────────────── Composant principal ──────────────────────────── */

export function StoresReport() {
  const [segment, setSegment] = useState<Segment>("ALL");
  const [nonce, setNonce] = useState(0);
  const [data, setData] = useState<StoresPayload | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setErr(null);
    const url = `/api/pilotage/stores?segment=${segment}${nonce > 0 ? "&refresh=1" : ""}`;
    fetch(url, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : r.json().then((j) => Promise.reject(j.error ?? r.statusText))))
      .then((j: StoresPayload) => { if (!cancelled) setData(j); })
      .catch((e) => { if (!cancelled) setErr(String(e)); });
    return () => { cancelled = true; };
  }, [segment, nonce]);

  const loading = data === null && err === null;

  return (
    <div className="h-full overflow-y-auto overflow-x-hidden">
      <div className="mx-auto max-w-[1180px] px-4 sm:px-8 py-6 pb-28">
        {/* En-tête */}
        <div className="flex items-start justify-between gap-4 mb-5">
          <div className="min-w-0">
            <Link
              href="/dashboard"
              className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-muted-foreground hover:text-foreground transition-colors mb-2"
            >
              <ArrowLeft className="h-3.5 w-3.5" /> Retour aux statistiques
            </Link>
            <p className="text-[11px] uppercase tracking-[0.16em] font-bold text-brand-500">
              Pilotage · Rentabilité par magasin
            </p>
            <h1 className="font-display text-[clamp(24px,3.4vw,36px)] font-bold leading-[1.1] tracking-tight text-foreground mt-0.5">
              Palmarès des magasins
            </h1>
            <p className="text-[13px] text-muted-foreground mt-1 max-w-[62ch]">
              Où va vraiment la marge — <span className="text-foreground font-medium">marge nette</span> par client
              (marge brute <span className="text-foreground font-medium">moins le coût de livraison</span>), sur les
              12&nbsp;derniers mois. Le détail complet est en bas de page.
            </p>
          </div>
          <button
            type="button"
            title="Actualiser les données"
            aria-label="Actualiser les données"
            onClick={() => setNonce((n) => n + 1)}
            className="shrink-0 inline-flex items-center justify-center h-9 w-9 rounded-lg bg-secondary/60 text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
          >
            <RefreshCw className="h-4 w-4" />
          </button>
        </div>

        {/* Filtre segment */}
        <div className="flex flex-wrap items-center gap-1.5 mb-6">
          {SEGMENTS.map((s) => {
            const active = segment === s.id;
            return (
              <button
                key={s.id}
                type="button"
                onClick={() => setSegment(s.id)}
                aria-pressed={active}
                className={`h-8 px-3 rounded-full text-[12px] font-semibold tracking-wide transition-colors ${
                  active
                    ? "bg-brand-500 text-[#0b1018] shadow-[0_0_12px_rgba(250,204,21,0.35)]"
                    : "bg-secondary/50 text-muted-foreground hover:text-foreground hover:bg-secondary"
                }`}
              >
                {s.label}
              </button>
            );
          })}
        </div>

        {loading && (
          <div className="flex items-center justify-center py-24"><SignalLoader /></div>
        )}
        {err && !loading && (
          <div className="rounded-xl border border-rose-500/40 bg-rose-500/10 px-4 py-3 text-[13px] text-rose-200">
            Impossible de charger le palmarès : {err}
          </div>
        )}

        {data && !loading && (
          data.nbStores === 0 ? (
            <div className="rounded-xl border border-border bg-card px-4 py-10 text-center text-[13px] text-muted-foreground">
              Aucun magasin facturé sur la période pour ce segment.
            </div>
          ) : (
            <Report data={data} />
          )
        )}
      </div>
    </div>
  );
}

/* ───────────────────────── Corps du rapport (données prêtes) ─────────────── */

function Report({ data }: { data: StoresPayload }) {
  const { stores, totals } = data;

  // Seuil de CA pour les classements en % (évite le bruit d'un petit compte à
  // marge % extrême sur une seule facture). Repli : pas de seuil si trop peu.
  const caThreshold = 5000;
  const rentables = useMemo(
    () => stores.filter((s) => s.ca >= caThreshold).length >= 5 ? caThreshold : 0,
    [stores],
  );

  const byNet = useMemo(() => [...stores].sort((a, b) => b.marginNet - a.marginNet), [stores]);
  const byCa = useMemo(() => [...stores].sort((a, b) => b.ca - a.ca), [stores]);
  const byNetPct = useMemo(
    () => stores.filter((s) => s.ca >= rentables && s.caProductNet > 0)
      .sort((a, b) => b.marginNetPct - a.marginNetPct),
    [stores, rentables],
  );
  const byTransport = useMemo(
    () => stores.filter((s) => s.transportCost > 0).sort((a, b) => b.transportCost - a.transportCost),
    [stores],
  );
  const byTransportShare = useMemo(
    () => stores.filter((s) => s.transportPctMargin != null && s.transportCost > 0)
      .sort((a, b) => (b.transportPctMargin ?? 0) - (a.transportPctMargin ?? 0)),
    [stores],
  );
  const worst = useMemo(
    () => [...stores].sort((a, b) => a.marginNet - b.marginNet).filter((s) => s.marginNet < totals.marginNet / Math.max(1, stores.length)),
    [stores, totals],
  );

  const podium = byNet.slice(0, 3);
  const nbNeg = stores.filter((s) => s.marginNet < 0).length;

  return (
    <>
      {/* Podium — le trio de tête en marge nette (gros chiffres blancs) */}
      <Podium rows={podium} />

      {/* KPI strip — totaux du périmètre */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mt-3">
        <Kpi label="Marge nette totale" value={fmtEur(totals.marginNet)} accent="brand"
             hint={`${data.nbStores} magasins · 12 mois`} />
        <Kpi label="Chiffre d'affaires" value={fmtEur(totals.ca)}
             hint={`${fmtWeight(totals.weightKg)} livrés`} />
        <Kpi label="Coût de livraison" value={fmtEur(totals.transportCost)}
             hint={data.transportConfigured
               ? `absorbe ${totals.transportPctMargin != null ? totals.transportPctMargin.toFixed(0) : "—"} % de la marge brute`
               : "transport non paramétré"} />
        <Kpi label="Marge nette moyenne" value={fmtPct(totals.marginNetPct)}
             hint={`marge brute ${totals.marginGrossPct.toFixed(1)} %`} />
      </div>

      {/* Bandeau : transport non configuré */}
      {!data.transportConfigured && (
        <div className="mt-4 flex items-start gap-2.5 rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-[12.5px] text-amber-100">
          <Info className="h-4 w-4 mt-0.5 shrink-0 text-amber-300" />
          <span>
            Le <b>coût de transport</b> n’est pas encore paramétré : la marge nette affichée est
            provisoirement égale à la marge brute.{" "}
            <Link href="/transport" className="underline underline-offset-2 font-semibold hover:text-white">
              Renseigner la structure de coûts →
            </Link>
          </span>
        </div>
      )}

      {/* Classements */}
      <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-3 mt-6">
        <Board
          icon={Trophy} accent="brand"
          title="Plus grosses marges nettes"
          hint="ce que chaque magasin rapporte, transport déduit"
          rows={byNet.slice(0, 10)}
          value={(s) => s.marginNet} fmt={fmtEurC}
          sub={(s) => `CA ${fmtEurC(s.ca)} · ${s.marginNetPct.toFixed(1)} %`}
        />
        <Board
          icon={Coins} accent="sky"
          title="Plus gros chiffre d'affaires"
          hint="le volume d'affaires brut"
          rows={byCa.slice(0, 10)}
          value={(s) => s.ca} fmt={fmtEurC}
          sub={(s) => `marge nette ${fmtEurC(s.marginNet)}`}
        />
        <Board
          icon={Gem} accent="emerald"
          title="Meilleure rentabilité nette"
          hint={rentables ? `magasins ≥ ${fmtEurC(rentables)} de CA` : "en % du CA produit"}
          rows={byNetPct.slice(0, 10)}
          value={(s) => s.marginNetPct} fmt={fmtPct}
          sub={(s) => `${fmtEurC(s.marginNet)} de marge nette`}
        />

        {data.transportConfigured && (
          <Board
            icon={Truck} accent="amber"
            title="Coûtent le plus cher à livrer"
            hint="coût de transport le plus élevé (€)"
            rows={byTransport.slice(0, 10)}
            value={(s) => s.transportCost} fmt={fmtEurC}
            sub={(s) => `${fmtWeight(s.weightKg)} · ${s.transportPctMargin != null ? s.transportPctMargin.toFixed(0) + " % de la marge" : "—"}`}
          />
        )}
        {data.transportConfigured && (
          <Board
            icon={Flame} accent="rose"
            title="Le transport ronge la marge"
            hint="part de la marge brute absorbée par la livraison"
            rows={byTransportShare.slice(0, 10)}
            value={(s) => s.transportPctMargin ?? 0} fmt={(v) => `${v.toFixed(0)} %`}
            sub={(s) => `transport ${fmtEurC(s.transportCost)} · marge nette ${fmtEurC(s.marginNet)}`}
          />
        )}
        <Board
          icon={TriangleAlert} accent="rose"
          title={nbNeg > 0 ? "Marge nette négative" : "Marges nettes les plus faibles"}
          hint={nbNeg > 0 ? `${nbNeg} magasin${nbNeg > 1 ? "s" : ""} en perte nette` : "à surveiller"}
          rows={worst.slice(0, 10)}
          value={(s) => s.marginNet} fmt={fmtEurC}
          sub={(s) => `CA ${fmtEurC(s.ca)} · transport ${fmtEurC(s.transportCost)}`}
          negative
        />
      </div>

      {/* Carte de positionnement — CA vs rentabilité nette, bulle = poids */}
      <Scatter stores={stores} avgNetPct={totals.marginNetPct} />

      {/* Détail complet */}
      <DetailTable stores={stores} configured={data.transportConfigured} />

      <p className="text-[11px] leading-relaxed text-muted-foreground/80 mt-6 max-w-[92ch]">
        Source : factures SAP (le facturé fait foi), 12&nbsp;mois glissants. La <b>marge brute</b> est calculée
        ligne à ligne au coût d’entrée marchandise réel. Le <b>coût de livraison</b> est compté <b>par position,
        facture par facture</b>, selon le transporteur réel du document (repli : tournée habituelle du client) —
        livraison <b>directe</b> = coût par position de la flotte ({fmtEur(data.costPerDelivery)}/livraison
        {data.prixPositionPerKg > 0 ? <> · réf. {fmtPerKg(data.prixPositionPerKg)}</> : null}), transporteur
        <b> externe</b> = grille par position (département × tranche de poids). Export/enlèvements (transport payé
        par le client ou transporteur sans tarif) restent à 0. La <b>marge nette</b> = marge brute − coût de
        livraison. Réglages dans <Link href="/transport" className="underline underline-offset-2">Coût de transport</Link>.
      </p>
    </>
  );
}

/* ───────────────────────── Podium (top 3 marge nette) ────────────────────── */

const PODIUM_STYLE = [
  { ring: "ring-brand-500/60",   badge: "bg-brand-500 text-[#0b1018]",   glow: "shadow-[0_0_28px_rgba(250,204,21,0.18)]", label: "N°1" },
  { ring: "ring-slate-300/40",   badge: "bg-slate-300 text-[#0b1018]",   glow: "", label: "N°2" },
  { ring: "ring-amber-700/50",   badge: "bg-amber-700 text-white",       glow: "", label: "N°3" },
];

function Podium({ rows }: { rows: StoreRow[] }) {
  if (rows.length === 0) return null;
  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
      {rows.map((s, i) => {
        const st = PODIUM_STYLE[i] ?? PODIUM_STYLE[2];
        return (
          <div
            key={s.cardCode}
            className={`relative rounded-2xl border border-border bg-card p-4 ring-1 ${st.ring} ${st.glow} ${i === 0 ? "sm:-mt-1" : ""}`}
          >
            <div className="flex items-center justify-between mb-2">
              <span className={`inline-flex items-center h-6 px-2 rounded-full text-[11px] font-bold tracking-wide ${st.badge}`}>
                {st.label}
              </span>
              {s.segment && (
                <span className={`inline-flex items-center gap-1.5 text-[10.5px] font-semibold uppercase tracking-[0.1em] ${SEG_TONE[s.segment].text}`}>
                  <span className={`h-1.5 w-1.5 rounded-full ${SEG_TONE[s.segment].dot}`} />
                  {segLabel(s.segment)}
                </span>
              )}
            </div>
            <p className="text-[14px] font-semibold text-foreground truncate" title={shortName(s.cardName, s.cardCode)}>
              {shortName(s.cardName, s.cardCode)}
            </p>
            <p className="font-display text-[clamp(26px,3.2vw,38px)] font-bold text-foreground tracking-tight tabular-nums leading-none mt-1.5">
              {fmtEur(s.marginNet)}
            </p>
            <p className="text-[11.5px] text-muted-foreground mt-1.5">
              marge nette · <span className="text-foreground/80 font-medium">{s.marginNetPct.toFixed(1)} %</span> du CA
              produit · CA {fmtEurC(s.ca)}
            </p>
          </div>
        );
      })}
    </div>
  );
}

/* ───────────────────────── KPI compact ──────────────────────────────────── */

function Kpi({ label, value, hint, accent }: { label: string; value: string; hint?: string; accent?: "brand" }) {
  return (
    <div className={`rounded-xl border border-border bg-card p-3.5 ${accent === "brand" ? "border-l-4 border-l-brand-500" : ""}`}>
      <p className="text-[10px] uppercase tracking-[0.14em] font-semibold text-muted-foreground">{label}</p>
      <p className={`font-display text-[clamp(21px,2.6vw,30px)] font-bold tracking-tight tabular-nums leading-none mt-1.5 ${accent === "brand" ? "text-brand-400" : "text-foreground"}`}>
        {value}
      </p>
      {hint && <p className="text-[11px] text-muted-foreground mt-1.5">{hint}</p>}
    </div>
  );
}

/* ───────────────────────── Board — classement générique ─────────────────── */

const BOARD_ACCENT: Record<string, { bar: string; icon: string; border: string }> = {
  brand:   { bar: "bg-brand-500/20",   icon: "text-brand-400",   border: "border-l-brand-500" },
  sky:     { bar: "bg-sky-500/20",     icon: "text-sky-300",     border: "border-l-sky-500" },
  emerald: { bar: "bg-emerald-500/20", icon: "text-emerald-300", border: "border-l-emerald-500" },
  amber:   { bar: "bg-amber-500/20",   icon: "text-amber-300",   border: "border-l-amber-500" },
  rose:    { bar: "bg-rose-500/20",    icon: "text-rose-300",    border: "border-l-rose-500" },
};

function Board({
  icon: Icon, title, hint, accent, rows, value, fmt, sub, negative,
}: {
  icon: typeof Trophy;
  title: string;
  hint?: string;
  accent: keyof typeof BOARD_ACCENT;
  rows: StoreRow[];
  value: (s: StoreRow) => number;
  fmt: (v: number) => string;
  sub?: (s: StoreRow) => string;
  negative?: boolean;
}) {
  const tone = BOARD_ACCENT[accent];
  // Base de la barre : max des valeurs absolues (les marges négatives se lisent).
  const max = Math.max(...rows.map((r) => Math.abs(value(r))), 1);
  return (
    <section className={`rounded-xl border border-border bg-card p-4 border-l-4 ${tone.border}`}>
      <div className="flex items-center gap-2 mb-0.5">
        <Icon className={`h-4 w-4 ${tone.icon}`} />
        <h3 className="text-[12.5px] font-bold text-foreground tracking-tight">{title}</h3>
      </div>
      {hint && <p className="text-[10.5px] text-muted-foreground mb-2.5 ml-6">{hint}</p>}
      <ol className="flex flex-col gap-1">
        {rows.map((s, i) => {
          const v = value(s);
          const bar = (Math.abs(v) / max) * 100;
          return (
            <li key={s.cardCode} className="grid grid-cols-[18px_1fr_auto] items-center gap-2 text-[12px]">
              <span className="text-muted-foreground/60 tabular-nums text-right text-[11px]">{i + 1}</span>
              <div className="min-w-0 relative">
                <div className={`absolute inset-y-0 left-0 rounded-sm ${tone.bar}`} style={{ width: `${bar}%` }} />
                <div className="relative px-1.5 py-1 min-w-0">
                  <span className="font-medium text-foreground truncate block" title={shortName(s.cardName, s.cardCode)}>
                    {shortName(s.cardName, s.cardCode)}
                  </span>
                  {sub && <span className="text-[10px] text-muted-foreground truncate block">{sub(s)}</span>}
                </div>
              </div>
              <span className={`font-bold tabular-nums whitespace-nowrap text-[12.5px] ${
                negative && v < 0 ? "text-rose-300" : "text-foreground"
              }`}>
                {fmt(v)}
              </span>
            </li>
          );
        })}
        {rows.length === 0 && (
          <li className="text-[11.5px] text-muted-foreground py-2">Aucune donnée.</li>
        )}
      </ol>
    </section>
  );
}

/* ───────────────────────── Nuage de positionnement (SVG) ─────────────────── */

function Scatter({ stores, avgNetPct }: { stores: StoreRow[]; avgNetPct: number }) {
  const [hover, setHover] = useState<{ s: StoreRow; x: number; y: number } | null>(null);
  const pts = useMemo(() => stores.filter((s) => s.ca > 0), [stores]);

  const W = 960, H = 340, m = { t: 16, r: 18, b: 34, l: 48 };
  const iw = W - m.l - m.r, ih = H - m.t - m.b;

  // X = CA (borné au p95 pour que les baleines n'écrasent pas le nuage).
  const cas = pts.map((s) => s.ca).sort((a, b) => a - b);
  const xMax = Math.max(cas[Math.floor(cas.length * 0.95)] ?? 1, 1);
  // Y = marge nette % (bornée à un intervalle lisible et symétrique autour de 0).
  const nps = pts.map((s) => s.marginNetPct);
  const yHi = Math.min(60, Math.max(10, Math.ceil((Math.max(...nps, 10) + 5) / 5) * 5));
  const yLo = Math.max(-40, Math.min(0, Math.floor((Math.min(...nps, 0) - 5) / 5) * 5));
  const wMax = Math.max(...pts.map((s) => s.weightKg), 1);

  const X = (v: number) => m.l + Math.min(v, xMax) / xMax * iw;
  const Y = (v: number) => m.t + ih - (Math.max(yLo, Math.min(yHi, v)) - yLo) / (yHi - yLo) * ih;
  const R = (w: number) => 3 + Math.sqrt(Math.max(0, w) / wMax) * 11;

  const yTicks: number[] = [];
  for (let t = yLo; t <= yHi + 0.001; t += (yHi - yLo) / 4) yTicks.push(Math.round(t));
  const xTicks = [0, 0.25, 0.5, 0.75, 1].map((f) => f * xMax);

  const dotColor = (s: StoreRow) =>
    s.marginNet < 0 ? "rgb(251 113 133)"
    : s.segment && SEG_TONE[s.segment] ? undefined : "rgb(148 163 184)";
  const segFill: Record<ClientSegment, string> = {
    GMS: "rgb(56 189 248)", CHR: "rgb(52 211 153)", EXPORT: "rgb(167 139 250)",
    RUNGIS: "rgb(251 191 36)", MIN_RUNGIS: "rgb(251 191 36)",
  };

  return (
    <section className="rounded-xl border border-border bg-card p-4 mt-6">
      <div className="flex flex-wrap items-baseline justify-between gap-2 mb-1">
        <h3 className="text-[12.5px] font-bold text-foreground tracking-tight">Positionnement des magasins</h3>
        <p className="text-[10.5px] text-muted-foreground">
          CA (horizontal) × rentabilité nette (vertical) · taille = poids livré
        </p>
      </div>
      <div className="relative">
        <svg viewBox={`0 0 ${W} ${H}`} width="100%" className="block" role="img"
             aria-label="Nuage de points : chiffre d'affaires en abscisse, marge nette % en ordonnée, taille selon le poids livré">
          {/* grille Y + libellés */}
          {yTicks.map((t, i) => (
            <g key={i}>
              <line x1={m.l} y1={Y(t)} x2={W - m.r} y2={Y(t)} stroke="hsl(var(--border))" strokeWidth={t === 0 ? 1.5 : 1} strokeDasharray={t === 0 ? "" : "2 4"} opacity={t === 0 ? 0.9 : 0.5} />
              <text x={m.l - 7} y={Y(t) + 3.5} textAnchor="end" fontSize="10" fill="hsl(var(--muted-foreground))">{t} %</text>
            </g>
          ))}
          {/* ligne moyenne */}
          <line x1={m.l} y1={Y(avgNetPct)} x2={W - m.r} y2={Y(avgNetPct)} stroke="rgb(250 204 21)" strokeWidth={1} strokeDasharray="5 4" opacity={0.6} />
          <text x={W - m.r} y={Y(avgNetPct) - 4} textAnchor="end" fontSize="9.5" fill="rgb(250 204 21)">moyenne {avgNetPct.toFixed(1)} %</text>
          {/* X ticks */}
          {xTicks.map((t, i) => (
            <text key={i} x={X(t)} y={H - 12} textAnchor="middle" fontSize="10" fill="hsl(var(--muted-foreground))">{fmtEurC(t)}</text>
          ))}
          <text x={W - m.r} y={H - 12} textAnchor="end" fontSize="9.5" fill="hsl(var(--muted-foreground))" opacity={0.7}>CA →</text>
          {/* points */}
          {pts.map((s) => (
            <circle
              key={s.cardCode}
              cx={X(s.ca)} cy={Y(s.marginNetPct)} r={R(s.weightKg)}
              fill={dotColor(s) ?? segFill[s.segment as ClientSegment]}
              fillOpacity={0.55} stroke={dotColor(s) ?? segFill[s.segment as ClientSegment]} strokeOpacity={0.9} strokeWidth={1}
              className="cursor-pointer transition-[fill-opacity]"
              onMouseEnter={() => setHover({ s, x: X(s.ca), y: Y(s.marginNetPct) })}
              onMouseLeave={() => setHover(null)}
            />
          ))}
        </svg>
        {hover && (
          <div
            className="pointer-events-none absolute z-10 rounded-lg border border-border bg-popover px-2.5 py-1.5 shadow-modal text-[11px]"
            style={{
              left: `min(${(hover.x / W) * 100}%, calc(100% - 180px))`,
              top: `calc(${(hover.y / H) * 100}% + 10px)`,
            }}
          >
            <p className="font-semibold text-foreground truncate max-w-[200px]">{shortName(hover.s.cardName, hover.s.cardCode)}</p>
            <p className="text-muted-foreground tabular-nums">
              CA {fmtEurC(hover.s.ca)} · nette <span className="text-foreground">{fmtEurC(hover.s.marginNet)}</span> ({hover.s.marginNetPct.toFixed(1)} %)
            </p>
            <p className="text-muted-foreground tabular-nums">{fmtWeight(hover.s.weightKg)} · transport {fmtEurC(hover.s.transportCost)}</p>
          </div>
        )}
      </div>
      {/* légende segments */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-2 ml-1">
        {(["GMS", "CHR", "EXPORT", "RUNGIS"] as ClientSegment[]).map((s) => (
          <span key={s} className="inline-flex items-center gap-1.5 text-[10.5px] text-muted-foreground">
            <span className="h-2 w-2 rounded-full" style={{ background: segFill[s] }} /> {segLabel(s)}
          </span>
        ))}
        <span className="inline-flex items-center gap-1.5 text-[10.5px] text-muted-foreground">
          <span className="h-2 w-2 rounded-full" style={{ background: "rgb(251 113 133)" }} /> marge nette négative
        </span>
      </div>
    </section>
  );
}

/* ───────────────────────── Table de détail (tri) ─────────────────────────── */

type SortKey = "ca" | "marginGross" | "marginGrossPct" | "weightKg" | "transportCost" | "marginNet" | "marginNetPct";

const COLS: { key: SortKey; label: string; fmt: (s: StoreRow) => string }[] = [
  { key: "ca",             label: "CA",            fmt: (s) => fmtEur(s.ca) },
  { key: "marginGross",    label: "Marge brute",   fmt: (s) => fmtEur(s.marginGross) },
  { key: "marginGrossPct", label: "Marge %",       fmt: (s) => fmtPct(s.marginGrossPct) },
  { key: "weightKg",       label: "Poids",         fmt: (s) => fmtWeight(s.weightKg) },
  { key: "transportCost",  label: "Coût livr.",    fmt: (s) => fmtEur(s.transportCost) },
  { key: "marginNet",      label: "Marge nette",   fmt: (s) => fmtEur(s.marginNet) },
  { key: "marginNetPct",   label: "Nette %",       fmt: (s) => fmtPct(s.marginNetPct) },
];

function DetailTable({ stores, configured }: { stores: StoreRow[]; configured: boolean }) {
  const [sort, setSort] = useState<SortKey>("marginNet");
  const [asc, setAsc] = useState(false);
  const [open, setOpen] = useState(false);

  const cols = configured ? COLS : COLS.filter((c) => c.key !== "transportCost");

  const sorted = useMemo(() => {
    const arr = [...stores].sort((a, b) => (a[sort] - b[sort]) * (asc ? 1 : -1));
    return arr;
  }, [stores, sort, asc]);

  const rows = open ? sorted : sorted.slice(0, 25);

  const setSortKey = (k: SortKey) => {
    if (k === sort) setAsc((v) => !v);
    else { setSort(k); setAsc(false); }
  };

  return (
    <section className="rounded-xl border border-border bg-card mt-6 overflow-hidden">
      <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-border">
        <div className="flex items-center gap-2">
          <ArrowUpDown className="h-4 w-4 text-muted-foreground" />
          <h3 className="text-[12.5px] font-bold text-foreground tracking-tight">Détail par magasin</h3>
          <span className="text-[11px] text-muted-foreground">{stores.length} magasins · clic sur une colonne pour trier</span>
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-[12px] tabular-nums">
          <thead>
            <tr className="text-[10px] uppercase tracking-[0.08em] text-muted-foreground/80 border-b border-border">
              <th className="text-left font-semibold px-3 py-2 w-8">#</th>
              <th className="text-left font-semibold px-3 py-2">Magasin</th>
              <th className="text-left font-semibold px-2 py-2">Seg.</th>
              {cols.map((c) => (
                <th key={c.key} className="px-3 py-2 text-right">
                  <button
                    type="button"
                    onClick={() => setSortKey(c.key)}
                    className={`inline-flex items-center gap-1 font-semibold uppercase tracking-[0.08em] hover:text-foreground transition-colors ${
                      sort === c.key ? "text-brand-400" : ""
                    }`}
                  >
                    {c.label}
                    {sort === c.key && <ChevronDown className={`h-3 w-3 transition-transform ${asc ? "rotate-180" : ""}`} />}
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((s, i) => (
              <tr key={s.cardCode} className="border-b border-border/50 hover:bg-secondary/30">
                <td className="px-3 py-1.5 text-muted-foreground/60 text-right text-[11px]">{i + 1}</td>
                <td className="px-3 py-1.5 max-w-[220px]">
                  <span className="font-medium text-foreground truncate block" title={shortName(s.cardName, s.cardCode)}>
                    {shortName(s.cardName, s.cardCode)}
                  </span>
                </td>
                <td className="px-2 py-1.5">
                  {s.segment ? (
                    <span className={`inline-flex items-center gap-1 text-[10px] font-semibold ${SEG_TONE[s.segment].text}`}>
                      <span className={`h-1.5 w-1.5 rounded-full ${SEG_TONE[s.segment].dot}`} />{segLabel(s.segment)}
                    </span>
                  ) : <span className="text-muted-foreground/50">—</span>}
                </td>
                {cols.map((c) => {
                  const neg = (c.key === "marginNet" || c.key === "marginNetPct") && s[c.key] < 0;
                  return (
                    <td key={c.key} className={`px-3 py-1.5 text-right whitespace-nowrap ${
                      c.key === "marginNet" ? "font-semibold" : ""
                    } ${neg ? "text-rose-300" : c.key === "marginNet" ? "text-foreground" : "text-foreground/80"}`}>
                      {c.fmt(s)}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {sorted.length > 25 && (
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="w-full py-2.5 text-[12px] font-semibold text-muted-foreground hover:text-foreground hover:bg-secondary/30 transition-colors border-t border-border"
        >
          {open ? "Réduire" : `Voir les ${sorted.length} magasins`}
        </button>
      )}
    </section>
  );
}
