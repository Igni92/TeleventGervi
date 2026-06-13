"use client";

import { motion, useReducedMotion } from "framer-motion";
import { Group } from "@visx/group";
import { Pie } from "@visx/shape";
import { CATEGORICAL } from "./theme";
import { DUR, EASE } from "@/lib/motion";

export interface DonutDatum {
  label: string;
  value: number;
  color?: string;
}

interface DonutProps {
  data: DonutDatum[];
  size?: number;
  thickness?: number;
  /** texte central (ex. total) */
  centerValue?: string;
  centerLabel?: string;
  className?: string;
  "aria-label"?: string;
}

/**
 * Donut visx — proportions (≤ 5 catégories, cf. no-pie-overuse).
 *
 * - Anneau fin, libellé central (total).
 * - Entrée animée douce (scale+fade), respecte reduced-motion.
 * - Légende texte avec valeurs → lisible sans dépendre de la couleur.
 */
export function Donut({
  data,
  size = 140,
  thickness = 16,
  centerValue,
  centerLabel,
  className,
  "aria-label": ariaLabel,
}: DonutProps) {
  const reduce = useReducedMotion();
  const radius = size / 2;
  const total = data.reduce((s, d) => s + d.value, 0);
  const colorOf = (d: DonutDatum, i: number) => d.color ?? CATEGORICAL[i % CATEGORICAL.length];

  if (total <= 0) {
    return (
      <p className="text-[12px] italic text-muted-foreground py-3 text-center">Aucune donnée.</p>
    );
  }

  return (
    <div className={`flex items-center gap-4 ${className ?? ""}`}>
      <motion.svg
        width={size} height={size} role="img"
        aria-label={ariaLabel ?? `Répartition : ${data.map((d) => `${d.label} ${d.value}`).join(", ")}`}
        initial={reduce ? { opacity: 1 } : { opacity: 0, scale: 0.96 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: DUR.base, ease: EASE.out }}
      >
        <Group top={radius} left={radius}>
          <Pie
            data={data}
            pieValue={(d) => d.value}
            outerRadius={radius - 1}
            innerRadius={radius - thickness}
            padAngle={0.02}
            cornerRadius={3}
          >
            {(pie) =>
              pie.arcs.map((arc, i) => (
                <path key={`${arc.data.label}-${i}`} d={pie.path(arc) || ""} fill={colorOf(arc.data, i)} />
              ))
            }
          </Pie>
          {centerValue && (
            <text textAnchor="middle" dy="-0.1em" fontSize={18} fontWeight={700} fill="hsl(var(--foreground))"
              style={{ fontVariantNumeric: "tabular-nums" }}>
              {centerValue}
            </text>
          )}
          {centerLabel && (
            <text textAnchor="middle" dy="1.3em" fontSize={9.5} fill="hsl(var(--muted-foreground))"
              style={{ textTransform: "uppercase", letterSpacing: "0.1em" }}>
              {centerLabel}
            </text>
          )}
        </Group>
      </motion.svg>

      <ul className="space-y-1 min-w-0">
        {data.map((d, i) => (
          <li key={`${d.label}-${i}`} className="flex items-center gap-2 text-[12px]">
            <span className="h-2.5 w-2.5 rounded-[3px] shrink-0" style={{ background: colorOf(d, i) }} />
            <span className="text-foreground/85 truncate">{d.label}</span>
            <span className="ml-auto font-semibold tnum text-foreground shrink-0">
              {Math.round((d.value / total) * 100)}%
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
