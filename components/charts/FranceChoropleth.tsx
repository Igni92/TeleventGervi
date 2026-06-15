"use client";

import { type ComponentProps, useEffect, useMemo, useRef, useState } from "react";
import { ParentSize } from "@visx/responsive";
import { Mercator } from "@visx/geo";
import type { GeoZone } from "@/lib/pilotageGeo";
import {
  type GeoMetric, geoValue, brandHeat, ZoneTooltipCard, loadGeo, type GeoFeature,
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
  zones, metric, onlyCodes, groupParis = false,
}: {
  zones: GeoZone[];
  metric: GeoMetric;
  onlyCodes?: string[];
  groupParis?: boolean;
}) {
  const [features, setFeatures] = useState<GeoFeature[] | null>(null);
  useEffect(() => {
    let on = true;
    loadGeo("/geo/fr-departements.json").then((g) => { if (on) setFeatures(g.features); });
    return () => { on = false; };
  }, []);

  const byCode = useMemo(() => {
    const m = new Map<string, GeoZone>();
    for (const z of zones) if (z.kind === "fr-dept") m.set(z.code, z);
    return m;
  }, [zones]);

  // Agrégat Île-de-France (pour le regroupement de la vue nationale).
  const idfZone = useMemo(() => (groupParis ? parisAggregate(zones) : null), [zones, groupParis]);

  // Départements effectivement dessinés (filtre du zoom).
  const shown = useMemo(
    () => (features ? (onlyCodes ? features.filter((f) => onlyCodes.includes(f.properties.code)) : features) : []),
    [features, onlyCodes],
  );

  // Zone associée à un code département — regroupe l'IDF en vue nationale.
  const zoneFor = (code: string): GeoZone | undefined =>
    (groupParis && isIDF(code) ? idfZone ?? undefined : byCode.get(code));

  const maxValue = useMemo(() => {
    let max = 0;
    for (const f of shown) {
      const code = f.properties.code;
      if (groupParis && isIDF(code)) continue; // compté via idfZone
      const z = byCode.get(code);
      if (z) max = Math.max(max, geoValue(z, metric));
    }
    if (idfZone) max = Math.max(max, geoValue(idfZone, metric));
    return max;
  }, [shown, byCode, idfZone, groupParis, metric]);

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
                      return (
                        <path
                          key={`dep-${i}`}
                          d={path || ""}
                          fill={z && v > 0 ? brandHeat(t) : "rgba(148,163,184,0.07)"}
                          stroke="rgba(148,163,184,0.35)"
                          strokeWidth={0.4}
                          style={{ cursor: z ? "pointer" : "default", transition: "fill 120ms" }}
                          onMouseMove={(e) => {
                            if (!z) return;
                            const r = wrapRef.current?.getBoundingClientRect();
                            setHover({ zone: z, x: e.clientX - (r?.left ?? 0), y: e.clientY - (r?.top ?? 0) });
                          }}
                          onMouseLeave={() => setHover(null)}
                        />
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
          className="absolute z-20"
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
