"use client";

import { Euro, Package, ShoppingCart, Percent, ChevronDown } from "lucide-react";
import { SurfaceCard, type Accent } from "@/components/ui/surface-card";
import { AnimatedNumber } from "@/components/ui/animated-number";
import { Delta } from "@/components/ui/delta";
import { InfoHint } from "@/components/ui/info-hint";
import { useJson, type FetchState } from "./use-json";

/**
 * Bandeau KPI DU JOUR — tuiles « gros chiffre » alimentées par une seule requête
 * GET /api/pilotage/activity?g=day (source SapOrder, vue commerciale).
 *
 * CA HT (BL), volume kg, nb commandes, + MARGE BRUTE % du jour — chacun avec sa
 * pastille N vs N-1 (même jour, année précédente). La marge est calculée sur le
 * coût RÉEL d'entrée marchandise (lib/cogs) ; sa FIABILITÉ (couverture du coût)
 * est affichée sous la tuile — elle s'affine dans la journée à mesure que les
 * réceptions rentrent.
 */

interface ActivityBucket {
  volume?: number;
  weightKg?: number;
  ordersCount?: number;
  marginPct?: number;       // marge brute / CA produit net × 100
  caProductNet?: number;    // base marge — 0 = pas encore de vente costable
}
interface ActivityResponse {
  curr?: ActivityBucket;
  prev?: ActivityBucket;
  /** Bornes de la fenêtre N-1 réellement comparée (même jour de la semaine,
   *  un an avant) — sert à afficher la DATE exacte du comparatif. */
  previous?: { start: string; end: string };
  /** Fiabilité : part des lignes du jour effectivement costées (coût hybride
   *  réception/fabrication/SAP) — proche de 100 %. */
  reliability?: number;
}

/** Date du jour comparé (N-1) en clair : « mardi 22 juillet 2025 ».
 *  Parsée à midi pour éviter tout décalage de fuseau sur une borne minuit UTC. */
function formatComparisonDay(iso?: string): string | null {
  if (!iso) return null;
  return new Date(`${iso.slice(0, 10)}T12:00:00`).toLocaleDateString("fr-FR", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

interface TileDef {
  label: string;
  icon: React.ReactNode;
  accent: Accent;
  suffix: string;
  compact?: boolean;
  pick: (b: ActivityBucket) => number;
  /** Ajoute une bulle de survol détaillant la ventilation du jour. */
  bubbleKind?: "ca" | "volume" | "orders";
}

const TILES: TileDef[] = [
  {
    label: "CA du jour",
    icon: <Euro className="h-3.5 w-3.5" />,
    accent: "brand",
    suffix: " €",
    compact: true,
    pick: (b) => b.volume ?? 0,
    bubbleKind: "ca",
  },
  {
    label: "Volume",
    icon: <Package className="h-3.5 w-3.5" />,
    accent: "sky",
    suffix: " kg",
    compact: true,
    pick: (b) => b.weightKg ?? 0,
    bubbleKind: "volume",
  },
  {
    label: "Commandes",
    icon: <ShoppingCart className="h-3.5 w-3.5" />,
    accent: "emerald",
    suffix: "",
    pick: (b) => b.ordersCount ?? 0,
    bubbleKind: "orders",
  },
];

interface FamilyVent { key: string; label: string; weightKg: number; caEur: number }
interface OrderVent { docNum: number | null; cardName: string | null; weightKg: number; caEur: number }
interface VentResp { totals: { weightKg: number; caEur: number; ordersCount: number }; families: FamilyVent[]; orders: OrderVent[] }

const eur0 = (v: number) => new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 }).format(v) + " €";
const kg0 = (v: number) => Math.round(v).toLocaleString("fr-FR") + " kg";
const share = (part: number, tot: number) => (tot > 0 ? Math.round((part / tot) * 100) : 0) + " %";

export function KpiStrip() {
  const { data, state } = useJson<ActivityResponse>("/api/pilotage/activity?g=day", 120_000);
  const { data: vent } = useJson<VentResp>("/api/accueil/ventilation", 5 * 60_000);
  const curr = data?.curr ?? {};
  const prev = data?.prev;
  const comparisonDay = formatComparisonDay(data?.previous?.start);

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
      {TILES.map((t, i) => {
        const value = t.pick(curr);
        const prevValue = prev ? t.pick(prev) : null;
        const hasBubble = !!t.bubbleKind && !!vent
          && (t.bubbleKind === "orders" ? vent.orders.length > 0 : vent.families.length > 0);
        return (
          <SurfaceCard key={t.label} accent={t.accent} delay={i * 50}
            className={`py-3.5${t.bubbleKind ? " group relative !overflow-visible" : ""}`}>
            <div className="flex items-center gap-1.5 text-muted-foreground">
              <span className="shrink-0 text-muted-foreground/70">{t.icon}</span>
              <span className="text-[11.5px] font-semibold uppercase tracking-[0.08em] leading-none">{t.label}</span>
              {hasBubble && <ChevronDown className="ml-auto h-3.5 w-3.5 text-muted-foreground/40 transition-colors group-hover:text-brand-500" />}
            </div>

            {state === "loading" ? (
              <div className="mt-3 h-[30px] w-24 rounded-md bg-secondary/70 animate-pulse" />
            ) : (
              <div className="mt-2.5 font-display text-[28px] sm:text-[32px] font-bold text-foreground leading-none tnum">
                {state === "error" ? (
                  <span className="text-muted-foreground">—</span>
                ) : (
                  <AnimatedNumber value={value} suffix={t.suffix} compact={t.compact && value >= 10_000} />
                )}
              </div>
            )}

            <div className="mt-2 flex items-center gap-1.5 min-h-[18px] whitespace-nowrap">
              {state === "ok" && prevValue != null && (
                <>
                  <Delta curr={value} prev={prevValue} size="sm" />
                  <InfoHint label={t.label} size={14}>
                    Comparé au même jour de la semaine, un an avant
                    {comparisonDay ? ` (${comparisonDay})` : " (N-1)"}.
                  </InfoHint>
                </>
              )}
              {state === "error" && (
                <span className="text-[10.5px] text-muted-foreground">Indisponible</span>
              )}
            </div>

            {hasBubble && vent && <KpiBubble kind={t.bubbleKind!} vent={vent} />}
          </SurfaceCard>
        );
      })}

      <MargeTile curr={curr} reliability={data?.reliability} state={state} delay={TILES.length * 50} />
    </div>
  );
}

/** Bulle de survol partagée — colonnes alignées, en-tête léger. `wide` = plus large
 *  et ancrée à droite (pour la liste des commandes : le nom/code client ne doit pas
 *  être tronqué). */
function Bubble({ cols, children, wide }: { cols: React.ReactNode; children: React.ReactNode; wide?: boolean }) {
  return (
    <div className={`pointer-events-none absolute top-full z-40 mt-2 origin-top scale-95 rounded-xl border border-border bg-popover p-1 opacity-0 shadow-xl transition-all duration-150 group-hover:scale-100 group-hover:opacity-100 ${wide ? "right-0 w-[26rem] max-w-[85vw]" : "inset-x-0"}`}>
      <div className="flex items-center gap-2 px-2 pb-1 pt-0.5 text-[9.5px] uppercase tracking-wide text-muted-foreground/70">{cols}</div>
      <ul className="max-h-64 overflow-y-auto">{children}</ul>
    </div>
  );
}

/** Bulle des KPI : ventilation du jour (CA/volume par catégorie, ou liste des commandes). */
function KpiBubble({ kind, vent }: { kind: "ca" | "volume" | "orders"; vent: VentResp }) {
  const { totals } = vent;
  if (kind === "orders") {
    return (
      <Bubble wide cols={<>
        <span className="min-w-0 flex-1">Client</span>
        <span className="w-16 text-right">CA</span>
        <span className="w-8 text-right">%</span>
        <span className="w-14 text-right">Poids</span>
        <span className="w-8 text-right">%</span>
      </>}>
        {vent.orders.map((o, i) => (
          <li key={i} className="flex items-center gap-2 rounded px-2 py-1 text-[12px] hover:bg-secondary/40">
            <span className="min-w-0 flex-1 truncate text-foreground" title={o.cardName ?? undefined}>{o.cardName ?? `Cmd ${o.docNum ?? "?"}`}</span>
            <span className="w-16 shrink-0 text-right tnum font-medium text-foreground">{eur0(o.caEur)}</span>
            <span className="w-8 shrink-0 text-right tnum text-[11px] text-muted-foreground">{share(o.caEur, totals.caEur)}</span>
            <span className="w-14 shrink-0 text-right tnum text-muted-foreground">{kg0(o.weightKg)}</span>
            <span className="w-8 shrink-0 text-right tnum text-[11px] text-muted-foreground">{share(o.weightKg, totals.weightKg)}</span>
          </li>
        ))}
      </Bubble>
    );
  }
  const metric = (f: FamilyVent) => (kind === "ca" ? f.caEur : f.weightKg);
  const total = kind === "ca" ? totals.caEur : totals.weightKg;
  const fmt = (v: number) => (kind === "ca" ? eur0(v) : kg0(v));
  const sorted = [...vent.families].filter((f) => metric(f) > 0).sort((a, b) => metric(b) - metric(a));
  return (
    <Bubble cols={<>
      <span className="min-w-0 flex-1">Catégorie</span>
      <span className="w-20 text-right">{kind === "ca" ? "CA" : "Poids"}</span>
      <span className="w-10 text-right">Part</span>
    </>}>
      {sorted.map((f) => (
        <li key={f.key} className="flex items-center gap-2 rounded px-2 py-1 text-[12.5px] hover:bg-secondary/40">
          <span className="min-w-0 flex-1 truncate text-foreground">{f.label}</span>
          <span className="w-20 shrink-0 text-right tnum font-semibold text-foreground">{fmt(metric(f))}</span>
          <span className="w-10 shrink-0 text-right tnum text-[11px] text-muted-foreground">{share(metric(f), total)}</span>
        </li>
      ))}
    </Bubble>
  );
}

interface FamilyMargeKg { key: string; label: string; weightKg: number; margeKg: number }
interface MargeKgResp { overall?: { margeKg: number; weightKg: number }; families?: FamilyMargeKg[] }
const eurKg = (v: number) =>
  new Intl.NumberFormat("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(v) + " €/kg";

/** Marge DU JOUR : % (marge brute) ET €/kg — coût réel d'entrée marchandise —
 *  avec le détail marge/kg PAR CATÉGORIE affiché au survol de la tuile. */
function MargeTile({ curr, reliability, state, delay }: { curr: ActivityBucket; reliability?: number | null; state: FetchState; delay: number }) {
  const pct = curr.marginPct ?? 0;
  const hasReliability = typeof reliability === "number";
  const coverage = Math.round(reliability ?? 0);
  const hasData = (curr.caProductNet ?? 0) > 0;
  const covTone = coverage >= 80 ? "text-emerald-600 dark:text-emerald-400"
    : coverage >= 50 ? "text-amber-600 dark:text-amber-400"
    : "text-muted-foreground";

  // Marge € PAR KG (globale + par catégorie) — endpoint dédié /api/accueil/marge-kg.
  const { data: mk } = useJson<MargeKgResp>("/api/accueil/marge-kg", 5 * 60_000);
  const margeKg = mk?.overall?.margeKg;
  const families = mk?.families ?? [];
  const hasKg = typeof margeKg === "number" && (mk?.overall?.weightKg ?? 0) > 0;

  return (
    <SurfaceCard accent="violet" delay={delay} className="py-3.5 group relative !overflow-visible">
      <div className="flex items-center gap-1.5 text-muted-foreground">
        <span className="shrink-0 text-muted-foreground/70"><Percent className="h-3.5 w-3.5" /></span>
        <span className="text-[11.5px] font-semibold uppercase tracking-[0.08em] leading-none">Marge du jour</span>
        {families.length > 0 && <ChevronDown className="ml-auto h-3.5 w-3.5 text-muted-foreground/40 transition-colors group-hover:text-brand-500" />}
      </div>

      {state === "loading" ? (
        <div className="mt-3 h-[30px] w-20 rounded-md bg-secondary/70 animate-pulse" />
      ) : (
        <div className="mt-2.5 flex items-baseline gap-2 font-display leading-none tnum">
          <span className="text-[28px] sm:text-[32px] font-bold text-foreground">
            {state === "error" || !hasData ? (
              <span className="text-muted-foreground">—</span>
            ) : (
              <>{pct.toFixed(1)}<span className="text-[18px] font-semibold text-muted-foreground"> %</span></>
            )}
          </span>
          {hasKg && (
            <>
              <span className="text-[20px] font-normal text-border">|</span>
              <span className="text-[20px] sm:text-[22px] font-bold text-emerald-600 dark:text-emerald-400">{eurKg(margeKg!)}</span>
            </>
          )}
        </div>
      )}

      <div className="mt-2 flex items-center gap-1.5 min-h-[18px] whitespace-nowrap">
        {state === "ok" && hasData && hasReliability ? (
          <>
            <span className="text-[10.5px] text-muted-foreground">
              fiabilité <b className={covTone}>{coverage}%</b>{coverage < 60 ? " · coût incomplet" : ""}
            </span>
            <InfoHint label="Marge du jour" size={14}>
              Marge brute du jour, en % et en € par kg, sur le coût réel d&apos;entrée marchandise.
              « Fiabilité » = part des lignes effectivement costées.
            </InfoHint>
          </>
        ) : state === "error" ? (
          <span className="text-[10.5px] text-muted-foreground">Indisponible</span>
        ) : state === "ok" && !hasData ? (
          <span className="text-[10.5px] text-muted-foreground">pas encore de vente costable</span>
        ) : null}
      </div>

      {families.length > 0 && (
        <Bubble cols={<>
          <span className="min-w-0 flex-1">Catégorie</span>
          <span className="w-20 text-right">€/kg</span>
          <span className="w-14 text-right">Poids</span>
        </>}>
          {families.map((f) => (
            <li key={f.key} className="flex items-center gap-2 rounded px-2 py-1 text-[12.5px] hover:bg-secondary/40">
              <span className="min-w-0 flex-1 truncate text-foreground">{f.label}</span>
              <span className="w-20 shrink-0 text-right tnum font-semibold text-emerald-600 dark:text-emerald-400">{eurKg(f.margeKg)}</span>
              <span className="w-14 shrink-0 text-right tnum text-[11px] text-muted-foreground">{Math.round(f.weightKg)} kg</span>
            </li>
          ))}
        </Bubble>
      )}
    </SurfaceCard>
  );
}
