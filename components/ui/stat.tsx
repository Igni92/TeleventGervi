"use client";

import { AnimatedNumber } from "./animated-number";
import { Delta } from "./delta";
import { Sparkline } from "@/components/charts/Sparkline";
import type { ChartTone } from "@/components/charts/theme";
import { cn } from "@/lib/utils";

interface StatProps {
  label: string;
  value: number;
  decimals?: number;
  prefix?: string;
  suffix?: string;
  compact?: boolean;
  /** comparaison YoY → pastille Delta */
  prev?: number;
  /** mini-tendance (sparkline) */
  spark?: number[];
  tone?: ChartTone;
  /** indice contextuel sous le label (ex. "vs même sem. N-1") */
  hint?: string;
  icon?: React.ReactNode;
  className?: string;
  /** taille de la valeur */
  size?: "md" | "lg" | "xl";
}

/**
 * Carte KPI unifiée — valeur animée + delta YoY + sparkline.
 *
 * Hiérarchie : label (kicker) → valeur (héros, AnimatedNumber) → tendance.
 * Une seule info dominante par carte (cf. visual-hierarchy / data-density).
 * Entrée fadeUp respectant reduced-motion.
 */
export function Stat({
  label, value, decimals = 0, prefix = "", suffix = "", compact = false,
  prev, spark, tone = "brand", hint, icon, className, size = "lg",
}: StatProps) {
  const valueCls =
    size === "xl" ? "text-[34px]" : size === "lg" ? "text-[26px]" : "text-[19px]";

  return (
    <div
      className={cn("flex flex-col justify-between h-full min-w-0 animate-fade-up motion-reduce:animate-none", className)}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="kicker truncate">{label}</span>
        {icon && <span className="text-muted-foreground/70 shrink-0">{icon}</span>}
      </div>

      <div className="mt-1.5 flex items-end justify-between gap-2">
        <div className="min-w-0">
          <div className={cn("font-display font-bold text-foreground leading-none", valueCls)}>
            <AnimatedNumber
              value={value}
              decimals={decimals}
              prefix={prefix}
              suffix={suffix}
              compact={compact}
            />
          </div>
          <div className="mt-1.5 flex items-center gap-2 flex-wrap">
            {prev != null && <Delta curr={value} prev={prev} size="sm" />}
            {hint && <span className="text-[10.5px] text-muted-foreground">{hint}</span>}
          </div>
        </div>
        {spark && spark.length > 1 && (
          <Sparkline data={spark} tone={tone} width={76} height={32} aria-label={`Tendance ${label}`} />
        )}
      </div>
    </div>
  );
}
