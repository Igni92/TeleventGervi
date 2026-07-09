"use client";

import { Euro, Package, ShoppingCart, Percent } from "lucide-react";
import { SurfaceCard, type Accent } from "@/components/ui/surface-card";
import { AnimatedNumber } from "@/components/ui/animated-number";
import { Delta } from "@/components/ui/delta";
import { useJson } from "./use-json";

/**
 * Bandeau KPI du jour — tuiles « gros chiffre ».
 *   • CA HT (BL), volume kg, nb commandes → GET /api/pilotage/activity?g=day
 *     (source SapOrder, vue commerciale), chacun avec pastille N vs N-1.
 *   • Marge brute % → GET /api/pilotage/marge (fenêtre glissante 30 j, coût RÉEL
 *     d'entrée marchandise — cf. lib/cogs). Affiche la FIABILITÉ (couverture) :
 *     plus les réceptions rentrent, plus le taux est fiable (il s'affine).
 */

interface ActivityBucket {
  volume?: number;
  weightKg?: number;
  ordersCount?: number;
}
interface ActivityResponse {
  curr?: ActivityBucket;
  prev?: ActivityBucket;
}
interface MargeResponse {
  days?: number;
  marginPct?: number;
  coverage?: number;       // % du CA produit dont le coût d'entrée est résolu
  caProductNet?: number;
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
              <div className="mt-3 h-[28px] w-24 rounded-md bg-secondary/70 animate-pulse" />
            ) : (
              <div className="mt-2.5 font-display text-[26px] sm:text-[28px] font-bold text-foreground leading-none tnum">
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
                  <span className="text-[10.5px] text-muted-foreground">vs N-1</span>
                </>
              )}
              {state === "error" && (
                <span className="text-[10.5px] text-muted-foreground">Indisponible</span>
              )}
            </div>
          </SurfaceCard>
        );
      })}

      <MargeTile delay={TILES.length * 50} />
    </div>
  );
}

/** Taux de marge brut (%) sur 30 j glissants + fiabilité (couverture du coût réel). */
function MargeTile({ delay }: { delay: number }) {
  const { data, state } = useJson<MargeResponse>("/api/pilotage/marge", 5 * 60_000);
  const pct = data?.marginPct ?? 0;
  const coverage = Math.round(data?.coverage ?? 0);
  const hasData = (data?.caProductNet ?? 0) > 0;
  // Fiabilité : le taux se fiabilise à mesure que les réceptions couvrent le CA.
  const covTone = coverage >= 80 ? "text-emerald-600 dark:text-emerald-400"
    : coverage >= 50 ? "text-amber-600 dark:text-amber-400"
    : "text-muted-foreground";

  return (
    <SurfaceCard accent="violet" delay={delay} className="py-3.5">
      <div className="flex items-center gap-1.5 text-muted-foreground">
        <span className="shrink-0 text-muted-foreground/70"><Percent className="h-3.5 w-3.5" /></span>
        <span className="text-[11.5px] font-semibold uppercase tracking-[0.08em] leading-none">Marge brute · 30 j</span>
      </div>

      {state === "loading" ? (
        <div className="mt-3 h-[28px] w-20 rounded-md bg-secondary/70 animate-pulse" />
      ) : (
        <div className="mt-2.5 font-display text-[26px] sm:text-[28px] font-bold text-foreground leading-none tnum">
          {state === "error" || !hasData ? (
            <span className="text-muted-foreground">—</span>
          ) : (
            <>{pct.toFixed(1)}<span className="text-[18px] font-semibold text-muted-foreground"> %</span></>
          )}
        </div>
      )}

      <div className="mt-2 flex items-center gap-1.5 min-h-[18px] whitespace-nowrap">
        {state === "ok" && hasData ? (
          <span className="text-[10.5px] text-muted-foreground" title="Part du chiffre d'affaires dont le coût d'entrée marchandise est connu — le taux se fiabilise à mesure que les réceptions rentrent.">
            fiabilité <b className={covTone}>{coverage}%</b>{coverage < 60 ? " · estimation" : ""}
          </span>
        ) : state === "error" ? (
          <span className="text-[10.5px] text-muted-foreground">Indisponible</span>
        ) : !hasData && state === "ok" ? (
          <span className="text-[10.5px] text-muted-foreground">en attente de ventes</span>
        ) : null}
      </div>
    </SurfaceCard>
  );
}
