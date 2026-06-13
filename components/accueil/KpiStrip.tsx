"use client";

import { Euro, Package, ShoppingCart, Users } from "lucide-react";
import { SurfaceCard, type Accent } from "@/components/ui/surface-card";
import { AnimatedNumber } from "@/components/ui/animated-number";
import { Delta } from "@/components/ui/delta";
import { useJson } from "./use-json";

/**
 * Bandeau KPI du jour — 4 tuiles « gros chiffre » alimentées par
 * GET /api/pilotage/activity?g=day (source SapOrder, vue commerciale).
 *
 * CA HT (BL), volume kg (règle maison : volume TOUJOURS en kg), nb commandes,
 * clients servis — chacun avec pastille N vs N-1 (même jour, année précédente).
 */

interface ActivityBucket {
  volume?: number;
  weightKg?: number;
  ordersCount?: number;
  activeClients?: number;
}
interface ActivityResponse {
  curr?: ActivityBucket;
  prev?: ActivityBucket;
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
    label: "CA du jour (HT)",
    icon: <Euro className="h-3.5 w-3.5" />,
    accent: "brand",
    suffix: " €",
    compact: true,
    pick: (b) => b.volume ?? 0,
  },
  {
    label: "Volume du jour",
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
  {
    label: "Clients servis",
    icon: <Users className="h-3.5 w-3.5" />,
    accent: "violet",
    suffix: "",
    pick: (b) => b.activeClients ?? 0,
  },
];

export function KpiStrip() {
  const { data, state } = useJson<ActivityResponse>("/api/pilotage/activity?g=day", 120_000);
  const curr = data?.curr ?? {};
  const prev = data?.prev;

  return (
    <div className="grid grid-cols-2 xl:grid-cols-4 gap-3">
      {TILES.map((t, i) => {
        const value = t.pick(curr);
        const prevValue = prev ? t.pick(prev) : null;
        return (
          <SurfaceCard key={t.label} accent={t.accent} delay={i * 50} className="py-3.5">
            <div className="flex items-center justify-between gap-2">
              <span className="kicker truncate">{t.label}</span>
              <span className="text-muted-foreground/60 shrink-0">{t.icon}</span>
            </div>

            {state === "loading" ? (
              <div className="mt-2.5 h-[30px] w-24 rounded-md bg-secondary/70 animate-pulse" />
            ) : (
              <div className="mt-1.5 font-display text-[28px] font-bold text-foreground leading-none">
                {state === "error" ? (
                  <span className="text-muted-foreground">—</span>
                ) : (
                  <AnimatedNumber value={value} suffix={t.suffix} compact={t.compact && value >= 10_000} />
                )}
              </div>
            )}

            <div className="mt-1.5 flex items-center gap-2 min-h-[16px]">
              {state === "ok" && prevValue != null && (
                <>
                  <Delta curr={value} prev={prevValue} size="sm" />
                  <span className="text-[10px] text-muted-foreground">vs même jour N-1</span>
                </>
              )}
              {state === "error" && (
                <span className="text-[10px] text-muted-foreground">Donnée indisponible</span>
              )}
            </div>
          </SurfaceCard>
        );
      })}
    </div>
  );
}
