"use client";

import { type ComponentProps, useEffect, useMemo, useRef, useState } from "react";
import { ParentSize } from "@visx/responsive";
import { NaturalEarth } from "@visx/geo";
import type { GeoZone } from "@/lib/pilotageGeo";
import {
  type GeoMetric, geoValue, ZoneTooltipCard, loadGeo, type GeoFeature,
} from "./geoShared";

// Casts de frontière visx (le GeoJSON statique n'est pas typé GeoPermissibleObjects).
type EarthData = NonNullable<ComponentProps<typeof NaturalEarth>["data"]>;
type EarthFit = NonNullable<ComponentProps<typeof NaturalEarth>["fitSize"]>;

/**
 * Carte monde à BULLES — destinations export + DOM (Guadeloupe, Réunion…).
 * Le fond (public/geo/world.json) est décoratif : la donnée est portée par les
 * bulles, placées au centroïde de chaque pays (lib/geo/countries) / DOM, ce qui
 * garantit l'affichage même des micro-États (Maldives…).
 */
export function WorldBubbleMap({ zones, metric }: { zones: GeoZone[]; metric: GeoMetric }) {
  const [features, setFeatures] = useState<GeoFeature[] | null>(null);
  useEffect(() => {
    let on = true;
    loadGeo("/geo/world.json").then((g) => { if (on) setFeatures(g.features); });
    return () => { on = false; };
  }, []);

  // Bulles = zones géolocalisées (pays export + DOM), triées desc (grosses dessous).
  const bubbles = useMemo(
    () => zones.filter((z) => z.lat != null && z.lng != null && geoValue(z, metric) > 0)
      .sort((a, b) => geoValue(b, metric) - geoValue(a, metric)),
    [zones, metric],
  );
  const maxValue = useMemo(() => bubbles.reduce((m, z) => Math.max(m, geoValue(z, metric)), 0), [bubbles, metric]);

  const [hover, setHover] = useState<{ zone: GeoZone; x: number; y: number } | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  if (!features) {
    return <div className="h-full grid place-items-center text-[12px] text-muted-foreground">Chargement de la carte…</div>;
  }
  const radiusOf = (v: number) => {
    if (maxValue <= 0) return 0;
    return 4 + Math.sqrt(v / maxValue) * 18; // aire ∝ valeur
  };

  return (
    <div ref={wrapRef} className="relative h-full w-full">
      <ParentSize>
        {({ width, height }) => {
          if (width < 10 || height < 10) return null;
          const fc = { type: "FeatureCollection", features };
          return (
            <svg width={width} height={height} role="img" aria-label="Carte monde — export et outre-mer">
              <NaturalEarth
                data={features as unknown as EarthData}
                fitSize={[[width, height], fc] as unknown as EarthFit}
              >
                {(proj) => (
                  <g>
                    {/* Fond décoratif */}
                    {proj.features.map(({ path }, i) => (
                      <path key={`c-${i}`} d={path || ""} fill="rgba(148,163,184,0.08)" stroke="rgba(148,163,184,0.18)" strokeWidth={0.4} />
                    ))}
                    {/* Bulles de données */}
                    {bubbles.map((z) => {
                      const xy = proj.projection([z.lng as number, z.lat as number]);
                      if (!xy) return null;
                      const r = radiusOf(geoValue(z, metric));
                      return (
                        <circle
                          key={z.id}
                          cx={xy[0]}
                          cy={xy[1]}
                          r={r}
                          fill="rgba(250,204,21,0.55)"
                          stroke="#facc15"
                          strokeWidth={1}
                          style={{ cursor: "pointer" }}
                          onMouseMove={(e) => {
                            const rect = wrapRef.current?.getBoundingClientRect();
                            setHover({ zone: z, x: e.clientX - (rect?.left ?? 0), y: e.clientY - (rect?.top ?? 0) });
                          }}
                          onMouseLeave={() => setHover(null)}
                        />
                      );
                    })}
                  </g>
                )}
              </NaturalEarth>
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
