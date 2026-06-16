"use client";

import { type ComponentProps, useEffect, useMemo, useRef, useState } from "react";
import { ParentSize } from "@visx/responsive";
import { Mercator } from "@visx/geo";
import type { GeoZone } from "@/lib/pilotageGeo";
import {
  type GeoMetric, type MapPoint, geoValue, brandHeat, ZoneTooltipCard, loadGeo, type GeoFeature,
  isIDF, parisAggregate,
} from "./geoShared";

// Casts de frontière visx (le GeoJSON statique n'est pas typé GeoPermissibleObjects).
type MercatorData = NonNullable<ComponentProps<typeof Mercator>["data"]>;
type MercatorFit = NonNullable<ComponentProps<typeof Mercator>["fitSize"]>;

/**
 * Choroplèthe des départements français. Fond : public/geo/fr-departements.json.
 *
 * - Vue nationale (`groupParis`) : les 8 départements franciliens partagent le
 *   même remplissage + un tooltip « Île-de-France » (la région est minuscule et
 *   illisible à l'échelle nationale → on la regroupe).
 * - Vue zoomée (`onlyCodes`) : ne dessine que ces départements, ajustés à leurs
 *   limites (ex. zoom Île-de-France détaillé, chaque département coloré seul).
 *
 * Les DOM ne sont pas ici (rendus en bulles sur la carte Outre-mer & Export).
 */
export function FranceChoropleth({
  zones, metric, onlyCodes, groupParis = false, points, onZoneClick,
}: {
  zones: GeoZone[];
  metric: GeoMetric;
  onlyCodes?: string[];
  groupParis?: boolean;
  /** Bulles clients à superposer (drill-down d'un département). */
  points?: MapPoint[];
  /** Clic sur un département (code, ou "IDF" si la région est regroupée). */
  onZoneClick?: (code: string) => void;
}) {
  const [features, setFeatures] = useState<GeoFeature[] | null>(null);
  useEffect(() => {
    let on = true;
    loadGeo("/geo/fr-departements.json").then((g) => { if (on) setFeatures(g.features); });
    return () => { on = false; };
  }, []);

  // Polygone Île-de-France d'un seul tenant (vue nationale) — Paris intégré,
  // sans délimitations départementales internes.
  const [idfFeature, setIdfFeature] = useState<GeoFeature | null>(null);
  useEffect(() => {
    if (!groupParis) return;
    let on = true;
    loadGeo("/geo/idf-region.json").then((g) => { if (on) setIdfFeature(g.features[0] ?? null); });
    return () => { on = false; };
  }, [groupParis]);

  const byCode = useMemo(() => {
    const m = new Map<string, GeoZone>();
    for (const z of zones) if (z.kind === "fr-dept") m.set(z.code, z);
    return m;
  }, [zones]);

  // Agrégat Île-de-France (pour le regroupement de la vue nationale).
  const idfZone = useMemo(() => (groupParis ? parisAggregate(zones) : null), [zones, groupParis]);

  // Départements dessinés. En vue nationale, on retire les 8 départements
  // franciliens et on ajoute le polygone IDF d'un seul tenant (code "IDF").
  const shown = useMemo(() => {
    if (!features) return [];
    if (onlyCodes) return features.filter((f) => onlyCodes.includes(f.properties.code));
    if (groupParis && idfFeature) {
      return [...features.filter((f) => !isIDF(f.properties.code)), idfFeature];
    }
    return features;
  }, [features, onlyCodes, groupParis, idfFeature]);

  // Zone associée à un code — "IDF" = agrégat régional, sinon le département.
  const zoneFor = (code: string): GeoZone | undefined =>
    (code === "IDF" ? idfZone ?? undefined : byCode.get(code));

  const maxValue = useMemo(() => {
    let max = 0;
    for (const f of shown) {
      const z = f.properties.code === "IDF" ? idfZone : byCode.get(f.properties.code);
      if (z) max = Math.max(max, geoValue(z, metric));
    }
    return max;
  }, [shown, byCode, idfZone, metric]);

  const pointMax = useMemo(() => (points ?? []).reduce((m, p) => Math.max(m, p.value), 0), [points]);

  const [hover, setHover] = useState<{ zone: GeoZone; x: number; y: number } | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  if (!features) {
    return <div className="h-full grid place-items-center text-[12px] text-muted-foreground">Chargement de la carte…</div>;
  }

  return (
    <div ref={wrapRef} className="relative h-full w-full">
      <ParentSize>
        {({ width, height }) => {
          if (width < 10 || height < 10) return null;
          const fc = { type: "FeatureCollection", features: shown };
          return (
            <svg width={width} height={height} role="img" aria-label="Carte de France — distribution par département">
              <Mercator
                data={shown as unknown as MercatorData}
                fitSize={[[width, height], fc] as unknown as MercatorFit}
              >
                {(mercator) => (
                  <g>
                    {mercator.features.map(({ feature, path }, i) => {
                      const code = (feature as unknown as GeoFeature).properties.code;
                      const z = zoneFor(code);
                      const v = z ? geoValue(z, metric) : 0;
                      const t = maxValue > 0 ? v / maxValue : 0;
                      const clickable = !!onZoneClick && !!z;
                      return (
                        <path
                          key={`dep-${i}`}
                          d={path || ""}
                          fill={z && v > 0 ? brandHeat(t) : "rgba(148,163,184,0.07)"}
                          stroke="rgba(148,163,184,0.35)"
                          strokeWidth={0.4}
                          style={{ cursor: clickable ? "pointer" : "default", transition: "fill 120ms" }}
                          onMouseMove={(e) => {
                            if (!z) return;
                            const r = wrapRef.current?.getBoundingClientRect();
                            setHover({ zone: z, x: e.clientX - (r?.left ?? 0), y: e.clientY - (r?.top ?? 0) });
                          }}
                          onMouseLeave={() => setHover(null)}
                          onClick={clickable ? () => onZoneClick!(code) : undefined}
                        />
                      );
                    })}
                    {points?.map((p) => {
                      const xy = mercator.projection([p.lng, p.lat]);
                      if (!xy) return null;
                      const r = pointMax > 0 ? 3 + Math.sqrt(p.value / pointMax) * 15 : 4;
                      return (
                        <circle
                          key={p.id}
                          cx={xy[0]}
                          cy={xy[1]}
                          r={r}
                          fill="rgba(56,189,248,0.55)"
                          stroke="#38bdf8"
                          strokeWidth={1}
                        >
                          <title>{p.label}{p.sub ? ` — ${p.sub}` : ""}</title>
                        </circle>
                      );
                    })}
                  </g>
                )}
              </Mercator>
            </svg>
          );
        }}
      </ParentSize>

      {hover && (
        <div
          className="absolute z-20 pointer-events-none"
          style={{
            left: Math.min(hover.x + 12, (wrapRef.current?.clientWidth ?? 0) - 170),
            top: Math.max(hover.y - 10, 4),
          }}
        >
          <ZoneTooltipCard zone={hover.zone} />
        </div>
      )}
    </div>
  );
}
