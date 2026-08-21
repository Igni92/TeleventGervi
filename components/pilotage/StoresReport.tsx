"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft, Trophy, Truck, Gem, TriangleAlert,
  Coins, RefreshCw, ArrowUpDown, ChevronDown,
} from "lucide-react";
import { formatEuro, formatNum } from "./bento";
import { SEGMENTS, type Segment, type ClientSegment } from "@/lib/segments";
import { SignalLoader } from "@/components/ui/page-loader";
import { Banner } from "@/components/ui/banner";
import { SegmentedControl } from "@/components/ui/segmented-control";

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
    transportCost: number; transportUnpriced: number; marginNet: number; marginGrossPct: number;
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

/* Couleur de segment — alignée sur la vérité de lib/segments (GMS teal ·
   CHR amber · EXPORT violet) ; hors segments livrés : neutre. */
// Couleur = IDENTITÉ de segment (donnée catégorielle), lisible en clair ET en
// sombre (valeur foncée en light, atténuée en dark).
const SEG_TONE: Record<ClientSegment, { dot: string; text: string }> = {
  GMS:       { dot: "bg-teal-500",    text: "text-teal-700 dark:text-teal-300" },
  CHR:       { dot: "bg-amber-500",   text: "text-amber-700 dark:text-amber-300" },
  EXPORT:    { dot: "bg-violet-500",  text: "text-violet-700 dark:text-violet-300" },
  RUNGIS:    { dot: "bg-muted-foreground",   text: "text-muted-foreground" },
  MIN_RUNGIS:{ dot: "bg-muted-foreground",   text: "text-muted-foreground" },
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
              className="inline-flex items-center gap-1.5 text-caption2 font-semibold text-muted-foreground hover:text-foreground transition-colors mb-2"
            >
              <ArrowLeft className="h-3.5 w-3.5" /> Retour aux statistiques
            </Link>
            <p className="text-caption2 uppercase tracking-[0.16em] font-bold text-brand-500">
              Pilotage · Rentabilité par magasin
            </p>
            <h1 className="font-display text-[clamp(24px,3.4vw,36px)] font-bold leading-[1.1] tracking-tight text-foreground mt-0.5">
              Palmarès des magasins
            </h1>
            <p className="text-body text-muted-foreground mt-1 max-w-[62ch]">
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
                className={`h-8 px-3 rounded-full text-caption font-semibold tracking-wide transition-colors ${
                  active
                    ? "bg-brand-500 text-primary-foreground"
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
          <Banner tone="danger" title="Palmarès indisponible">
            Impossible de charger le palmarès : {err}
          </Banner>
        )}

        {data && !loading && (
          data.nbStores === 0 ? (
            <div className="rounded-xl border border-border bg-card px-4 py-10 text-center text-body text-muted-foreground">
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
  const worst = useMemo(
    () => [...stores].sort((a, b) => a.marginNet - b.marginNet).filter((s) => s.marginNet < totals.marginNet / Math.max(1, stores.length)),
    [stores, totals],
  );

  const podium = byNet.slice(0, 3);
  const nbNeg = stores.filter((s) => s.marginNet < 0).length;

  // Magasin survolé — relie le nuage de points et la table de détail (survol
  // d'un point → surligne sa ligne, et réciproquement).
  const [hovered, setHovered] = useState<string | null>(null);

  // UN SEUL classement héros (marge nette = podium) puis une LISTE à
  // SegmentedControl : chaque « lentille » remplace les ex-6 boards.
  type Lens = "net" | "ca" | "pct" | "transport" | "risk";
  const [lens, setLens] = useState<Lens>("net");
  const LENS: Record<Lens, {
    icon: typeof Trophy; title: string; hint: string; rows: StoreRow[];
    value: (s: StoreRow) => number; fmt: (v: number) => string;
    sub: (s: StoreRow) => string; negative?: boolean;
  }> = {
    net: {
      icon: Trophy, title: "Plus grosses marges nettes",
      hint: "ce que chaque magasin rapporte, transport déduit",
      rows: byNet.slice(0, 10), value: (s) => s.marginNet, fmt: fmtEurC,
      sub: (s) => `CA ${fmtEurC(s.ca)} · ${s.marginNetPct.toFixed(1)} %`,
    },
    ca: {
      icon: Coins, title: "Plus gros chiffre d'affaires",
      hint: "le volume d'affaires brut",
      rows: byCa.slice(0, 10), value: (s) => s.ca, fmt: fmtEurC,
      sub: (s) => `marge nette ${fmtEurC(s.marginNet)}`,
    },
    pct: {
      icon: Gem, title: "Meilleure rentabilité nette",
      hint: rentables ? `magasins ≥ ${fmtEurC(rentables)} de CA` : "en % du CA produit",
      rows: byNetPct.slice(0, 10), value: (s) => s.marginNetPct, fmt: fmtPct,
      sub: (s) => `${fmtEurC(s.marginNet)} de marge nette`,
    },
    transport: {
      icon: Truck, title: "Coûtent le plus cher à livrer",
      hint: "coût de transport le plus élevé",
      rows: byTransport.slice(0, 10), value: (s) => s.transportCost, fmt: fmtEurC,
      sub: (s) => `${fmtWeight(s.weightKg)} · ${s.transportPctMargin != null ? s.transportPctMargin.toFixed(0) + " % de la marge" : "—"}`,
    },
    risk: {
      icon: TriangleAlert, title: nbNeg > 0 ? "Marge nette négative" : "Marges nettes les plus faibles",
      hint: nbNeg > 0 ? `${nbNeg} magasin${nbNeg > 1 ? "s" : ""} en perte nette` : "à surveiller",
      rows: worst.slice(0, 10), value: (s) => s.marginNet, fmt: fmtEurC,
      sub: (s) => `CA ${fmtEurC(s.ca)} · transport ${fmtEurC(s.transportCost)}`, negative: true,
    },
  };
  const lensOptions: { value: Lens; label: string }[] = [
    { value: "net", label: "Marge nette" },
    { value: "ca", label: "CA" },
    { value: "pct", label: "Rentabilité" },
    ...(data.transportConfigured ? [{ value: "transport" as Lens, label: "Transport" }] : []),
    { value: "risk", label: "À risque" },
  ];
  const safeLens: Lens = lensOptions.some((o) => o.value === lens) ? lens : "net";
  const cfg = LENS[safeLens];

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

      {/* Bandeau : positions livrées sans tarif applicable (coût transport sous-estimé) */}
      {data.transportConfigured && totals.transportUnpriced > 0 && (
        <Banner
          tone="warning"
          className="mt-4"
          title={`${formatNum(totals.transportUnpriced)} position(s) sans tarif`}
          action={
            <Link href="/transport" className="text-body font-semibold text-foreground underline underline-offset-2 whitespace-nowrap">
              Compléter les tarifs →
            </Link>
          }
        >
          Coût transport non calculé (comptées 0 €). La marge nette est sur-estimée pour ces magasins.
        </Banner>
      )}

      {/* Bandeau : transport non configuré */}
      {!data.transportConfigured && (
        <Banner
          tone="warning"
          className="mt-4"
          title="Coût de transport non paramétré"
          action={
            <Link href="/transport" className="text-body font-semibold text-foreground underline underline-offset-2 whitespace-nowrap">
              Renseigner les coûts →
            </Link>
          }
        >
          La marge nette affichée est provisoirement égale à la marge brute.
        </Banner>
      )}

      {/* Classement — une seule liste, la lentille se choisit au SegmentedControl */}
      <section className="rounded-xl border border-border bg-card p-4 mt-6">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
          <div className="flex items-center gap-2 min-w-0">
            <cfg.icon className="h-4 w-4 text-brand-500 shrink-0" />
            <div className="min-w-0">
              <h3 className="text-callout font-bold text-foreground tracking-tight truncate">{cfg.title}</h3>
              <p className="text-caption2 text-muted-foreground truncate">{cfg.hint}</p>
            </div>
          </div>
          <SegmentedControl<Lens>
            value={safeLens}
            onChange={setLens}
            options={lensOptions}
            aria-label="Choisir le classement"
            className="shrink-0"
          />
        </div>
        <Board
          rows={cfg.rows}
          value={cfg.value}
          fmt={cfg.fmt}
          sub={cfg.sub}
          negative={cfg.negative}
          hovered={hovered}
          onHover={setHovered}
        />
      </section>

      {/* Carte de positionnement — CA vs rentabilité nette, bulle = poids */}
      <Scatter stores={stores} avgNetPct={totals.marginNetPct} hovered={hovered} onHover={setHovered} />

      {/* Détail complet */}
      <DetailTable stores={stores} configured={data.transportConfigured} hovered={hovered} onHover={setHovered} />

      <p className="text-caption2 leading-relaxed text-muted-foreground/80 mt-6 max-w-[92ch]">
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

// N°1 en case de PRISE D'INFO teintée or (le héros du palmarès) ; N°2/N°3
// sobres. Plus de glow jaune en dur — le rang se lit à la pastille et au fond.
const PODIUM_STYLE = [
  { card: "border-brand-500/35 bg-brand-500/[0.10]", badge: "bg-brand-500 text-primary-foreground", label: "N°1" },
  { card: "border-border bg-card",                   badge: "bg-secondary text-foreground",         label: "N°2" },
  { card: "border-border bg-card",                   badge: "bg-secondary text-foreground",         label: "N°3" },
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
            className={`relative rounded-2xl border p-4 ${st.card} ${i === 0 ? "sm:-mt-1" : ""}`}
          >
            <div className="flex items-center justify-between mb-2">
              <span className={`inline-flex items-center h-6 px-2 rounded-full text-caption2 font-bold tracking-wide ${st.badge}`}>
                {st.label}
              </span>
              {s.segment && (
                <span className={`inline-flex items-center gap-1.5 text-caption2 font-semibold uppercase tracking-[0.1em] ${SEG_TONE[s.segment].text}`}>
                  <span className={`h-1.5 w-1.5 rounded-full ${SEG_TONE[s.segment].dot}`} />
                  {segLabel(s.segment)}
                </span>
              )}
            </div>
            <p className="text-callout font-semibold text-foreground truncate" title={shortName(s.cardName, s.cardCode)}>
              {shortName(s.cardName, s.cardCode)}
            </p>
            <p className="font-display text-[clamp(26px,3.2vw,38px)] font-bold text-foreground tracking-tight tabular-nums leading-none mt-1.5">
              {fmtEur(s.marginNet)}
            </p>
            <p className="text-caption text-muted-foreground mt-1.5">
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
  // Case d'INFO : l'unique KPI accentué (marge nette totale) est teinté or,
  // sans filet coloré. Les autres restent neutres.
  const tinted = accent === "brand";
  return (
    <div className={`rounded-xl border p-3.5 ${tinted ? "border-brand-500/35 bg-brand-500/[0.10]" : "border-border bg-card"}`}>
      <p className="text-caption2 uppercase tracking-[0.14em] font-semibold text-muted-foreground">{label}</p>
      <p className="font-display text-[clamp(21px,2.6vw,30px)] font-bold tracking-tight tabular-nums leading-none mt-1.5 text-foreground">
        {value}
      </p>
      {hint && <p className="text-caption2 text-muted-foreground mt-1.5">{hint}</p>}
    </div>
  );
}

/* ───────────────────────── Board — classement générique ─────────────────── */

function Board({
  rows, value, fmt, sub, negative, hovered, onHover,
}: {
  rows: StoreRow[];
  value: (s: StoreRow) => number;
  fmt: (v: number) => string;
  sub?: (s: StoreRow) => string;
  negative?: boolean;
  hovered?: string | null;
  onHover?: (code: string | null) => void;
}) {
  // Base de la barre : max des valeurs absolues (les marges négatives se lisent).
  // Barre de magnitude en accent UNIQUE (or), jamais multicolore.
  const max = Math.max(...rows.map((r) => Math.abs(value(r))), 1);
  return (
    <ol className="flex flex-col gap-0.5">
      {rows.map((s, i) => {
        const v = value(s);
        const bar = (Math.abs(v) / max) * 100;
        const on = hovered === s.cardCode;
        return (
          <li
            key={s.cardCode}
            className={`grid grid-cols-[18px_1fr_auto] items-center gap-2 text-caption rounded-md transition-colors ${on ? "bg-secondary/60" : ""}`}
            onMouseEnter={() => onHover?.(s.cardCode)}
            onMouseLeave={() => onHover?.(null)}
          >
            <span className="text-muted-foreground/60 tabular-nums text-right text-caption2">{i + 1}</span>
            <div className="min-w-0 relative">
              <div className="absolute inset-y-0 left-0 rounded-sm bg-brand-500/20" style={{ width: `${bar}%` }} />
              <div className="relative px-1.5 py-1 min-w-0">
                <span className="font-medium text-foreground truncate block" title={shortName(s.cardName, s.cardCode)}>
                  {shortName(s.cardName, s.cardCode)}
                </span>
                {sub && <span className="text-caption2 text-muted-foreground truncate block">{sub(s)}</span>}
              </div>
            </div>
            <span className={`font-bold tabular-nums whitespace-nowrap text-caption pr-1.5 ${
              negative && v < 0 ? "text-destructive" : "text-foreground"
            }`}>
              {fmt(v)}
            </span>
          </li>
        );
      })}
      {rows.length === 0 && (
        <li className="text-caption text-muted-foreground py-2">Aucune donnée.</li>
      )}
    </ol>
  );
}

/* ───────────────────────── Nuage de positionnement (SVG) ─────────────────── */

function Scatter({ stores, avgNetPct, hovered, onHover }: {
  stores: StoreRow[]; avgNetPct: number;
  hovered?: string | null; onHover?: (code: string | null) => void;
}) {
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
  // Remplissages alignés sur SEG_TONE (teal/amber/violet-400, neutre sinon).
  const segFill: Record<ClientSegment, string> = {
    GMS: "rgb(45 212 191)", CHR: "rgb(251 191 36)", EXPORT: "rgb(167 139 250)",
    RUNGIS: "rgb(148 163 184)", MIN_RUNGIS: "rgb(148 163 184)",
  };

  return (
    <section className="rounded-xl border border-border bg-card p-4 mt-6">
      <div className="flex flex-wrap items-baseline justify-between gap-2 mb-1">
        <h3 className="text-caption font-bold text-foreground tracking-tight">Positionnement des magasins</h3>
        <p className="text-caption2 text-muted-foreground">
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
          {/* ligne moyenne (accent or) */}
          <line x1={m.l} y1={Y(avgNetPct)} x2={W - m.r} y2={Y(avgNetPct)} stroke="hsl(var(--brand-500))" strokeWidth={1} strokeDasharray="5 4" opacity={0.6} />
          <text x={W - m.r} y={Y(avgNetPct) - 4} textAnchor="end" fontSize="9.5" fill="hsl(var(--brand-500))">moyenne {avgNetPct.toFixed(1)} %</text>
          {/* X ticks */}
          {xTicks.map((t, i) => (
            <text key={i} x={X(t)} y={H - 12} textAnchor="middle" fontSize="10" fill="hsl(var(--muted-foreground))">{fmtEurC(t)}</text>
          ))}
          <text x={W - m.r} y={H - 12} textAnchor="end" fontSize="9.5" fill="hsl(var(--muted-foreground))" opacity={0.7}>CA →</text>
          {/* points — le magasin survolé (ici ou dans la table) est mis en avant */}
          {pts.map((s) => {
            const on = hovered === s.cardCode;
            const c = dotColor(s) ?? segFill[s.segment as ClientSegment];
            return (
              <circle
                key={s.cardCode}
                cx={X(s.ca)} cy={Y(s.marginNetPct)} r={on ? R(s.weightKg) + 2 : R(s.weightKg)}
                fill={c}
                fillOpacity={on ? 0.85 : 0.55}
                stroke={on ? "hsl(var(--foreground))" : c}
                strokeOpacity={on ? 1 : 0.9}
                strokeWidth={on ? 1.5 : 1}
                className="cursor-pointer transition-[fill-opacity,r]"
                onMouseEnter={() => { setHover({ s, x: X(s.ca), y: Y(s.marginNetPct) }); onHover?.(s.cardCode); }}
                onMouseLeave={() => { setHover(null); onHover?.(null); }}
              />
            );
          })}
        </svg>
        {hover && (
          <div
            className="pointer-events-none absolute z-10 rounded-lg border border-border bg-popover px-2.5 py-1.5 shadow-modal text-caption2"
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
          <span key={s} className="inline-flex items-center gap-1.5 text-caption2 text-muted-foreground">
            <span className="h-2 w-2 rounded-full" style={{ background: segFill[s] }} /> {segLabel(s)}
          </span>
        ))}
        <span className="inline-flex items-center gap-1.5 text-caption2 text-muted-foreground">
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

function DetailTable({ stores, configured, hovered, onHover }: {
  stores: StoreRow[]; configured: boolean;
  hovered?: string | null; onHover?: (code: string | null) => void;
}) {
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
          <h3 className="text-caption font-bold text-foreground tracking-tight">Détail par magasin</h3>
          <span className="text-caption2 text-muted-foreground">{stores.length} magasins · clic sur une colonne pour trier</span>
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-caption tabular-nums">
          <thead>
            <tr className="text-caption2 uppercase tracking-[0.08em] text-muted-foreground/80 border-b border-border">
              <th className="text-left font-semibold px-3 py-2 w-8">n°</th>
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
              <tr
                key={s.cardCode}
                className={`border-b border-border/50 transition-colors ${hovered === s.cardCode ? "bg-secondary/60" : "hover:bg-secondary/30"}`}
                onMouseEnter={() => onHover?.(s.cardCode)}
                onMouseLeave={() => onHover?.(null)}
              >
                <td className="px-3 py-1.5 text-muted-foreground/60 text-right text-caption2">{i + 1}</td>
                <td className="px-3 py-1.5 max-w-[220px]">
                  <span className="font-medium text-foreground truncate block" title={shortName(s.cardName, s.cardCode)}>
                    {shortName(s.cardName, s.cardCode)}
                  </span>
                </td>
                <td className="px-2 py-1.5">
                  {s.segment ? (
                    <span className={`inline-flex items-center gap-1 text-caption2 font-semibold ${SEG_TONE[s.segment].text}`}>
                      <span className={`h-1.5 w-1.5 rounded-full ${SEG_TONE[s.segment].dot}`} />{segLabel(s.segment)}
                    </span>
                  ) : <span className="text-muted-foreground/50">—</span>}
                </td>
                {cols.map((c) => {
                  const neg = (c.key === "marginNet" || c.key === "marginNetPct") && s[c.key] < 0;
                  return (
                    <td key={c.key} className={`px-3 py-1.5 text-right whitespace-nowrap ${
                      c.key === "marginNet" ? "font-semibold" : ""
                    } ${neg ? "text-destructive" : c.key === "marginNet" ? "text-foreground" : "text-foreground/80"}`}>
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
          className="w-full py-2.5 text-caption font-semibold text-muted-foreground hover:text-foreground hover:bg-secondary/30 transition-colors border-t border-border"
        >
          {open ? "Réduire" : `Voir les ${sorted.length} magasins`}
        </button>
      )}
    </section>
  );
}
