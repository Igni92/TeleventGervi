"use client";

import { useId, useMemo, useCallback } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { Group } from "@visx/group";
import { LinePath, AreaClosed, Bar, Line } from "@visx/shape";
import { scaleLinear, scalePoint } from "@visx/scale";
import { curveMonotoneX } from "@visx/curve";
import { LinearGradient } from "@visx/gradient";
import { GridRows } from "@visx/grid";
import { AxisBottom } from "@visx/axis";
import { ParentSize } from "@visx/responsive";
import { useTooltip, useTooltipInPortal, defaultStyles } from "@visx/tooltip";
import { localPoint } from "@visx/event";
import { CHART, toneColor, type ChartTone } from "./theme";
import { DUR, EASE } from "@/lib/motion";

export interface TrendPoint {
  label: string;
  value: number;
  /** valeur de comparaison (N-1) optionnelle — tracée en pointillé */
  compare?: number;
  /** info secondaire pré-formatée pour le tooltip (ex. "3,20 €/kg") — courant */
  sub?: string;
  /** idem pour la ligne de comparaison N-1 */
  compareSub?: string;
}

interface TrendAreaProps {
  data: TrendPoint[];
  tone?: ChartTone;
  /** hauteur fixe (number px) ou "100%" pour remplir un parent à hauteur résolue */
  height?: number | string;
  /** formate les valeurs dans le tooltip / axe */
  format?: (v: number) => string;
  /** légende N vs N-1 */
  compareLabel?: string;
  currentLabel?: string;
  className?: string;
  "aria-label"?: string;
}

const MARGIN = { top: 12, right: 12, bottom: 24, left: 8 };

/**
 * Graphe de tendance (aire + ligne) responsive — visx.
 *
 * - Aire dégradée + ligne lissée, tracé animé (respecte reduced-motion).
 * - Comparatif N-1 en pointillé (cf. dashboard YoY).
 * - Grille discrète, axe X auto-skip, tooltip + crosshair au survol/tap.
 * - aria-label résume l'insight (accessibilité chart).
 */
export function TrendArea(props: TrendAreaProps) {
  return (
    <div className={props.className} style={{ width: "100%", height: props.height ?? 180 }}>
      <ParentSize debounceTime={8}>
        {({ width, height }) =>
          width > 0 ? <TrendAreaInner {...props} width={width} height={height} /> : null
        }
      </ParentSize>
    </div>
  );
}

function TrendAreaInner({
  data,
  tone = "brand",
  format = (v) => new Intl.NumberFormat("fr-FR").format(Math.round(v)),
  compareLabel = "N-1",
  currentLabel = "N",
  width,
  height,
  "aria-label": ariaLabel,
}: TrendAreaProps & { width: number; height: number }) {
  const reduce = useReducedMotion();
  const gradId = useId();
  const color = toneColor(tone);

  const innerW = Math.max(0, width - MARGIN.left - MARGIN.right);
  const innerH = Math.max(0, height - MARGIN.top - MARGIN.bottom);

  const hasCompare = data.some((d) => typeof d.compare === "number");
  const allVals = data.flatMap((d) => [d.value, ...(d.compare != null ? [d.compare] : [])]);
  const maxV = Math.max(1, ...allVals);

  const xScale = useMemo(
    () => scalePoint<string>({ domain: data.map((d) => d.label), range: [0, innerW], padding: 0.5 }),
    [data, innerW],
  );
  const yScale = useMemo(
    () => scaleLinear<number>({ domain: [0, maxV * 1.1], range: [innerH, 0], nice: true }),
    [maxV, innerH],
  );

  const cx = (d: TrendPoint) => xScale(d.label) ?? 0;
  const cyV = (d: TrendPoint) => yScale(d.value) ?? 0;

  const { tooltipData, tooltipLeft, tooltipTop, showTooltip, hideTooltip } = useTooltip<TrendPoint>();
  const { containerRef, TooltipInPortal } = useTooltipInPortal({ scroll: true, detectBounds: true });

  const handleMove = useCallback(
    (e: React.MouseEvent | React.TouchEvent) => {
      const p = localPoint(e) ?? { x: 0 };
      const relX = p.x - MARGIN.left;
      // point le plus proche
      let nearest = data[0];
      let best = Infinity;
      for (const d of data) {
        const dist = Math.abs((xScale(d.label) ?? 0) - relX);
        if (dist < best) { best = dist; nearest = d; }
      }
      showTooltip({
        tooltipData: nearest,
        tooltipLeft: (xScale(nearest.label) ?? 0) + MARGIN.left,
        tooltipTop: cyV(nearest) + MARGIN.top,
      });
    },
    [data, xScale, showTooltip], // eslint-disable-line react-hooks/exhaustive-deps
  );

  // auto-skip des ticks X sur petit écran
  const tickEvery = Math.ceil(data.length / Math.max(3, Math.floor(innerW / 60)));
  const tickValues = data.filter((_, i) => i % tickEvery === 0).map((d) => d.label);

  return (
    <div style={{ position: "relative" }}>
      <svg ref={containerRef} width={width} height={height} role="img"
        aria-label={ariaLabel ?? `Tendance ${currentLabel}${hasCompare ? ` vs ${compareLabel}` : ""}`}>
        <LinearGradient id={gradId} from={color} to={color} fromOpacity={0.26} toOpacity={0.02} />
        <Group left={MARGIN.left} top={MARGIN.top}>
          <GridRows scale={yScale} width={innerW} numTicks={3} stroke={CHART.grid} strokeWidth={1} />

          {/* Aire principale */}
          <AreaClosed<TrendPoint>
            data={data}
            x={(d) => cx(d)}
            y={(d) => cyV(d)}
            yScale={yScale}
            curve={curveMonotoneX}
            fill={`url(#${gradId})`}
            stroke="transparent"
          />

          {/* Comparatif N-1 en pointillé */}
          {hasCompare && (
            <LinePath<TrendPoint>
              data={data.filter((d) => d.compare != null)}
              x={(d) => cx(d)}
              y={(d) => yScale(d.compare as number) ?? 0}
              curve={curveMonotoneX}
              stroke={CHART.axis}
              strokeWidth={1.5}
              strokeDasharray="3 3"
              fill="none"
            />
          )}

          {/* Ligne principale animée */}
          <LinePath<TrendPoint> data={data} x={(d) => cx(d)} y={(d) => cyV(d)} curve={curveMonotoneX}>
            {({ path }) => {
              const d = path(data) || "";
              return reduce ? (
                <path d={d} stroke={color} strokeWidth={2.25} fill="none" strokeLinecap="round" />
              ) : (
                <motion.path
                  d={d} stroke={color} strokeWidth={2.25} fill="none" strokeLinecap="round"
                  initial={{ pathLength: 0 }} animate={{ pathLength: 1 }}
                  transition={{ duration: DUR.slow, ease: EASE.out }}
                />
              );
            }}
          </LinePath>

          <AxisBottom
            top={innerH}
            scale={xScale}
            tickValues={tickValues}
            stroke={CHART.grid}
            hideTicks
            tickLabelProps={() => ({
              fill: CHART.axis, fontSize: 10, textAnchor: "middle", dy: "0.25em",
            })}
          />

          {/* Crosshair + point au survol */}
          {tooltipData && (
            <Group>
              <Line
                from={{ x: (xScale(tooltipData.label) ?? 0), y: 0 }}
                to={{ x: (xScale(tooltipData.label) ?? 0), y: innerH }}
                stroke={CHART.axis} strokeWidth={1} strokeDasharray="2 2" pointerEvents="none"
              />
              <circle cx={xScale(tooltipData.label) ?? 0} cy={cyV(tooltipData)} r={3.5}
                fill={color} stroke="hsl(var(--card))" strokeWidth={2} pointerEvents="none" />
            </Group>
          )}

          {/* Capteur d'interaction */}
          <Bar x={0} y={0} width={innerW} height={innerH} fill="transparent"
            onMouseMove={handleMove} onMouseLeave={hideTooltip}
            onTouchStart={handleMove} onTouchMove={handleMove} />
        </Group>
      </svg>

      {tooltipData && (
        <TooltipInPortal
          left={tooltipLeft}
          top={tooltipTop}
          style={{ ...defaultStyles, background: "hsl(var(--popover))", color: "hsl(var(--popover-foreground))",
            border: "1px solid hsl(var(--border))", borderRadius: 10, padding: "6px 10px",
            fontSize: 12, boxShadow: "var(--shadow-modal)" }}
        >
          <div style={{ fontWeight: 600, marginBottom: 2 }}>{tooltipData.label}</div>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ width: 8, height: 8, borderRadius: 99, background: color }} />
            {currentLabel} · <b>{format(tooltipData.value)}</b>
            {tooltipData.sub ? <span style={{ opacity: 0.85 }}>· {tooltipData.sub}</span> : null}
          </div>
          {tooltipData.compare != null && (
            <div style={{ display: "flex", alignItems: "center", gap: 6, opacity: 0.8 }}>
              <span style={{ width: 8, height: 2, background: CHART.axis }} />
              {compareLabel} · {format(tooltipData.compare)}
              {tooltipData.compareSub ? <span>· {tooltipData.compareSub}</span> : null}
            </div>
          )}
        </TooltipInPortal>
      )}
    </div>
  );
}
