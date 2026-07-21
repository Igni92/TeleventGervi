"use client";

import { Euro, Package, ShoppingCart, Percent } from "lucide-react";
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
}

const TILES: TileDef[] = [
  {
    label: "CA du jour",
    icon: <Euro className="h-3.5 w-3.5" />,
    accent: "brand",
    suffix: " €",
    compact: true,
    pick: (b) => b.volume ?? 0,
  },
  {
    label: "Volume",
    icon: <Package className="h-3.5 w-3.5" />,
    accent: "sky",
    suffix: " kg",
    compact: true,
    pick: (b) => b.weightKg ?? 0,
  },
  {
    label: "Commandes",
    icon: <ShoppingCart className="h-3.5 w-3.5" />,
    accent: "emerald",
    suffix: "",
    pick: (b) => b.ordersCount ?? 0,
  },
];

export function KpiStrip() {
  const { data, state } = useJson<ActivityResponse>("/api/pilotage/activity?g=day", 120_000);
  const curr = data?.curr ?? {};
  const prev = data?.prev;
  const comparisonDay = formatComparisonDay(data?.previous?.start);

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
      {TILES.map((t, i) => {
        const value = t.pick(curr);
        const prevValue = prev ? t.pick(prev) : null;
        return (
          <SurfaceCard key={t.label} accent={t.accent} delay={i * 50} className="py-3.5">
            <div className="flex items-center gap-1.5 text-muted-foreground">
              <span className="shrink-0 text-muted-foreground/70">{t.icon}</span>
              <span className="text-[11.5px] font-semibold uppercase tracking-[0.08em] leading-none">{t.label}</span>
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
                  {/* Explication du comparatif → derrière le « ? » (masqué mobile). */}
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
          </SurfaceCard>
        );
      })}

      <MargeTile curr={curr} reliability={data?.reliability} state={state} delay={TILES.length * 50} />
    </div>
  );
}

/** Marge brute % DU JOUR (coût réel d'entrée marchandise) + fiabilité (marchandise reçue). */
function MargeTile({ curr, reliability, state, delay }: { curr: ActivityBucket; reliability?: number | null; state: FetchState; delay: number }) {
  const pct = curr.marginPct ?? 0;
  const hasReliability = typeof reliability === "number";
  const coverage = Math.round(reliability ?? 0);
  const hasData = (curr.caProductNet ?? 0) > 0;
  // Fiabilité = part des lignes du jour effectivement costées (coût hybride
  // réception/fabrication/SAP). Proche de 100 % ; < 100 % = lignes sans coût connu.
  const covTone = coverage >= 80 ? "text-emerald-600 dark:text-emerald-400"
    : coverage >= 50 ? "text-amber-600 dark:text-amber-400"
    : "text-muted-foreground";

  return (
    <SurfaceCard accent="violet" delay={delay} className="py-3.5">
      <div className="flex items-center gap-1.5 text-muted-foreground">
        <span className="shrink-0 text-muted-foreground/70"><Percent className="h-3.5 w-3.5" /></span>
        <span className="text-[11.5px] font-semibold uppercase tracking-[0.08em] leading-none">Marge du jour</span>
      </div>

      {state === "loading" ? (
        <div className="mt-3 h-[30px] w-20 rounded-md bg-secondary/70 animate-pulse" />
      ) : (
        <div className="mt-2.5 font-display text-[28px] sm:text-[32px] font-bold text-foreground leading-none tnum">
          {state === "error" || !hasData ? (
            <span className="text-muted-foreground">—</span>
          ) : (
            <>{pct.toFixed(1)}<span className="text-[18px] font-semibold text-muted-foreground"> %</span></>
          )}
        </div>
      )}

      <div className="mt-2 flex items-center gap-1.5 min-h-[18px] whitespace-nowrap">
        {state === "ok" && hasData && hasReliability ? (
          <>
            <span className="text-[10.5px] text-muted-foreground">
              fiabilité <b className={covTone}>{coverage}%</b>{coverage < 60 ? " · coût incomplet" : ""}
            </span>
            {/* Le mode de calcul (long) vit derrière le « ? » — plus de title= natif. */}
            <InfoHint label="Marge du jour" size={14}>
              Marge brute du jour. Coût de chaque vente : réception récente si disponible,
              sinon coût de fabrication, sinon coût enregistré par SAP sur la ligne (pied de BL).
              « Fiabilité » = part des lignes effectivement costées — proche de 100 %.
            </InfoHint>
          </>
        ) : state === "error" ? (
          <span className="text-[10.5px] text-muted-foreground">Indisponible</span>
        ) : state === "ok" && !hasData ? (
          <span className="text-[10.5px] text-muted-foreground">pas encore de vente costable</span>
        ) : null}
      </div>
    </SurfaceCard>
  );
}
