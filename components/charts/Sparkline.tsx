"use client";

import { useId } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { Group } from "@visx/group";
import { LinePath, AreaClosed } from "@visx/shape";
import { scaleLinear } from "@visx/scale";
import { curveMonotoneX } from "@visx/curve";
import { LinearGradient } from "@visx/gradient";
import { ParentSize } from "@visx/responsive";
import { toneColor, type ChartTone } from "./theme";
import { DUR, EASE } from "@/lib/motion";

interface SparklineProps {
  data: number[];
  width?: number;
  height?: number;
  tone?: ChartTone;
  /** trace l'aire dégradée sous la courbe */
  area?: boolean;
  /** point sur la dernière valeur */
  showDot?: boolean;
  strokeWidth?: number;
  /** occupe toute la largeur du parent (mesurée) */
  responsive?: boolean;
  className?: string;
  "aria-label"?: string;
}

/** Wrapper qui choisit le mode fixe ou responsive. */
export function Sparkline(props: SparklineProps) {
  if (props.responsive) {
    const { height = 32, className } = props;
    return (
      <div className={className} style={{ width: "100%", height }}>
        <ParentSize debounceTime={8}>
          {({ width }) => (width > 0 ? <SparklineSvg {...props} width={width} className={undefined} /> : null)}
        </ParentSize>
      </div>
    );
  }
  return <SparklineSvg {...props} />;
}

/**
 * Sparkline visx — micro-tendance inline (KPI, lignes de tableau).
 *
 * - Pas d'axe : densité maximale, lecture immédiate.
 * - Dégradé d'aire optionnel, point terminal optionnel.
 * - Tracé animé (path draw) qui respecte prefers-reduced-motion.
 * - aria-label obligatoire pour les lecteurs d'écran (chart accessible).
 */
function SparklineSvg({
  data,
  width = 96,
  height = 28,
  tone = "brand",
  area = true,
  showDot = true,
  strokeWidth = 1.75,
  className,
  "aria-label": ariaLabel,
}: SparklineProps) {
  const reduce = useReducedMotion();
  const gradId = useId();
  const color = toneColor(tone);

  if (!data || data.length === 0) {
    return <svg width={width} height={height} className={className} aria-hidden />;
  }

  const pad = strokeWidth + 1;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const xScale = scaleLinear({ domain: [0, data.length - 1], range: [pad, width - pad] });
  const yScale = scaleLinear({
    domain: [min === max ? min - 1 : min, min === max ? max + 1 : max],
    range: [height - pad, pad],
  });

  const x = (_: number, i: number) => xScale(i) ?? 0;
  const y = (d: number) => yScale(d) ?? 0;
  const lastX = x(data[data.length - 1], data.length - 1);
  const lastY = y(data[data.length - 1]);

  return (
    <svg
      width={width}
      height={height}
      className={className}
      role="img"
      aria-label={ariaLabel ?? `Tendance sur ${data.length} points`}
    >
      <LinearGradient id={gradId} from={color} to={color} fromOpacity={0.22} toOpacity={0} />
      <Group>
        {area && (
          <AreaClosed
            data={data}
            x={x}
            y={y}
            yScale={yScale}
            curve={curveMonotoneX}
            fill={`url(#${gradId})`}
            stroke="transparent"
          />
        )}
        <LinePath data={data} x={x} y={y} curve={curveMonotoneX}>
          {({ path }) => {
            const d = path(data) || "";
            return reduce ? (
              <path d={d} stroke={color} strokeWidth={strokeWidth} fill="none" strokeLinecap="round" />
            ) : (
              <motion.path
                d={d}
                stroke={color}
                strokeWidth={strokeWidth}
                fill="none"
                strokeLinecap="round"
                initial={{ pathLength: 0, opacity: 0.4 }}
                animate={{ pathLength: 1, opacity: 1 }}
                transition={{ duration: DUR.slow, ease: EASE.out }}
              />
            );
          }}
        </LinePath>
        {showDot && (
          <circle cx={lastX} cy={lastY} r={2.4} fill={color} stroke="hsl(var(--card))" strokeWidth={1.5} />
        )}
      </Group>
    </svg>
  );
}
