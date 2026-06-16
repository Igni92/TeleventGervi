"use client";

import "maplibre-gl/dist/maplibre-gl.css";
import { useEffect, useMemo, useRef, useState } from "react";
import MapGL, { Source, Layer, Popup, NavigationControl, type MapLayerMouseEvent, type MapRef } from "react-map-gl/maplibre";
import type { GeoZone, GeoClient } from "@/lib/pilotageGeo";
import {
  type GeoMetric, geoValue, geoMetricLabel, loadGeo, loadCp, type GeoFeature, isIDF, parisAggregate,
} from "./geoShared";
import { formatEuro, formatNum } from "@/components/pilotage/bento";
import { formatWeight } from "./geoShared";

/* Dégradé séquentiel premium (ambre → orange → rose) sur fond sombre. */
const RAMP = [[253, 230, 138], [251, 191, 36], [251, 146, 60], [244, 63, 94]];
function rampColor(t: number): string {
  const x = Math.max(0, Math.min(1, t)) * (RAMP.length - 1);
  const i = Math.floor(x);
  const f = x - i;
  const a = RAMP[i];
  const b = RAMP[Math.min(i + 1, RAMP.length - 1)];
  const c = (k: number) => Math.round(a[k] + (b[k] - a[k]) * f);
  return `rgb(${c(0)}, ${c(1)}, ${c(2)})`;
}

const MAP_STYLE = {
  version: 8 as const,
  sources: {},
  layers: [{ id: "bg", type: "background" as const, paint: { "background-color": "#0b1018" } }],
};

type HoverInfo = { lng: number; lat: number; zone: Partial<GeoZone> & { name?: string } };
type FranceMode = "2d" | "3d" | "heat";

/**
 * Carte vectorielle interactive (MapLibre GL).
 * - France : choroplèthe 3D extrudée (hauteur = métrique) OU heatmap « chaleur de
 *   livraison » (densité clients). Île-de-France fusionnée, vol fluide au clic.
 * - Monde : bulles export/outre-mer.
 * 100 % auto-hébergé (nos GeoJSON), sans clé API.
 */
export function GeoMapGL({
  view, zones, metric, clients, onZoneClick,
}: {
  view: "france" | "world";
  zones: GeoZone[];
  metric: GeoMetric;
  clients?: GeoClient[];
  onZoneClick?: (code: string) => void;
}) {
  const mapRef = useRef<MapRef>(null);
  const [frDeps, setFrDeps] = useState<GeoFeature[] | null>(null);
  const [idf, setIdf] = useState<GeoFeature | null>(null);
  const [world, setWorld] = useState<GeoFeature[] | null>(null);
  const [cp, setCp] = useState<Record<string, [number, number]> | null>(null);
  const [hover, setHover] = useState<HoverInfo | null>(null);
  const [cursor, setCursor] = useState<"grab" | "pointer">("grab");
  const [mode, setMode] = useState<FranceMode>("3d");

  useEffect(() => {
    let on = true;
    if (view === "france") {
      loadGeo("/geo/fr-departements.json").then((g) => on && setFrDeps(g.features));
      loadGeo("/geo/idf-region.json").then((g) => on && setIdf(g.features[0] ?? null));
    } else {
      loadGeo("/geo/world.json").then((g) => on && setWorld(g.features));
    }
    return () => { on = false; };
  }, [view]);

  // Codes postaux chargés pour la heatmap (densité clients).
  useEffect(() => {
    if (view !== "france" || mode !== "heat" || cp) return;
    let on = true;
    loadCp().then((m) => on && setCp(m));
    return () => { on = false; };
  }, [view, mode, cp]);

  // Bascule de pitch (3D ↔ à plat) en douceur.
  useEffect(() => {
    if (view !== "france") return;
    mapRef.current?.easeTo({ pitch: mode === "3d" ? 42 : 0, duration: 500 });
  }, [mode, view]);

  const byCode = useMemo(() => {
    const m = new Map<string, GeoZone>();
    for (const z of zones) if (z.kind === "fr-dept") m.set(z.code, z);
    return m;
  }, [zones]);

  // FeatureCollection France (départements, IDF fusionnée) : couleur + hauteur 3D.
  const franceFc = useMemo(() => {
    if (!frDeps) return null;
    const idfZone = parisAggregate(zones);
    const feats = frDeps.filter((f) => !isIDF(f.properties.code));
    if (idf) feats.push(idf);
    const valueOf = (code: string) => (code === "IDF" ? (idfZone ? geoValue(idfZone, metric) : 0) : (byCode.get(code) ? geoValue(byCode.get(code)!, metric) : 0));
    const max = feats.reduce((mx, f) => Math.max(mx, valueOf(f.properties.code)), 0);
    return {
      type: "FeatureCollection" as const,
      features: feats.map((f) => {
        const code = f.properties.code;
        const z = code === "IDF" ? idfZone : byCode.get(code);
        const v = valueOf(code);
        const t = max > 0 ? v / max : 0;
        return {
          type: "Feature" as const,
          geometry: f.geometry,
          properties: {
            code,
            name: z?.name ?? f.properties.nom ?? code,
            fillColor: v > 0 ? rampColor(t) : "rgba(148,163,184,0.06)",
            height: v > 0 ? 8000 + t * 130000 : 0,
            ca: z?.ca ?? 0, margin: z?.margin ?? 0, weightKg: z?.weightKg ?? 0, docs: z?.docs ?? 0, clients: z?.clients ?? 0,
            hasData: v > 0 ? 1 : 0,
          },
        };
      }),
    };
  }, [frDeps, idf, zones, byCode, metric]);

  // Points clients (heatmap densité) — France, géolocalisés au code postal.
  const heatFc = useMemo(() => {
    if (!cp || !clients) return null;
    const fr = clients.filter((c) => c.kind === "fr-dept");
    const max = fr.reduce((mx, c) => Math.max(mx, geoValue(c, metric)), 0) || 1;
    const features = [];
    for (const c of fr) {
      const zip = (c.zip ?? "").replace(/\D/g, "").slice(0, 5);
      const xy = zip ? cp[zip] : undefined;
      const v = geoValue(c, metric);
      if (!xy || v <= 0) continue;
      features.push({
        type: "Feature" as const,
        geometry: { type: "Point" as const, coordinates: xy },
        properties: { w: Math.max(0.05, v / max) },
      });
    }
    return { type: "FeatureCollection" as const, features };
  }, [cp, clients, metric]);

  // Bulles export/outre-mer.
  const bubbleFc = useMemo(() => {
    const pts = zones.filter((z) => z.lat != null && z.lng != null && geoValue(z, metric) > 0);
    const max = pts.reduce((mx, z) => Math.max(mx, geoValue(z, metric)), 0);
    return {
      type: "FeatureCollection" as const,
      features: pts.map((z) => ({
        type: "Feature" as const,
        geometry: { type: "Point" as const, coordinates: [z.lng as number, z.lat as number] },
        properties: {
          code: z.code, name: z.name,
          r: max > 0 ? 5 + Math.sqrt(geoValue(z, metric) / max) * 26 : 6,
          ca: z.ca, margin: z.margin, weightKg: z.weightKg, docs: z.docs, clients: z.clients,
        },
      })),
    };
  }, [zones, metric]);

  const worldFc = useMemo(() => (world ? { type: "FeatureCollection" as const, features: world } : null), [world]);

  const franceLayer = view === "france" ? (mode === "3d" ? "fr-ext" : "fr-fill") : null;
  const interactiveLayerIds = view === "france" ? (franceLayer ? [franceLayer] : []) : ["world-bubbles"];

  const onMove = (e: MapLayerMouseEvent) => {
    const f = e.features?.[0];
    if (!f) { setHover(null); setCursor("grab"); return; }
    const p = f.properties as Record<string, unknown>;
    setCursor(view === "france" ? (Number(p.hasData) ? "pointer" : "grab") : "pointer");
    setHover({
      lng: e.lngLat.lng, lat: e.lngLat.lat,
      zone: {
        name: String(p.name ?? ""),
        ca: Number(p.ca), margin: Number(p.margin), weightKg: Number(p.weightKg),
        docs: Number(p.docs), clients: Number(p.clients),
      },
    });
  };
  const onLeave = () => { setHover(null); setCursor("grab"); };
  const onClick = (e: MapLayerMouseEvent) => {
    if (view !== "france" || !onZoneClick) return;
    const f = e.features?.[0];
    if (f && Number((f.properties as Record<string, unknown>).hasData)) {
      // Vol fluide vers la zone puis ouverture du détail.
      mapRef.current?.easeTo({ center: [e.lngLat.lng, e.lngLat.lat], zoom: Math.min((mapRef.current.getZoom() ?? 4.4) + 1.3, 7), duration: 550 });
      onZoneClick(String((f.properties as Record<string, unknown>).code));
    }
  };

  const initialViewState = view === "france"
    ? { longitude: 2.4, latitude: 46.4, zoom: 4.3, pitch: 42 }
    : { longitude: 15, latitude: 22, zoom: 0.55 };

  return (
    <div className="relative h-full w-full overflow-hidden rounded-lg">
      <MapGL
        ref={mapRef}
        initialViewState={initialViewState}
        mapStyle={MAP_STYLE as never}
        interactiveLayerIds={interactiveLayerIds}
        onMouseMove={onMove}
        onMouseLeave={onLeave}
        onClick={onClick}
        cursor={cursor}
        attributionControl={false}
        dragRotate={false}
        maxPitch={60}
        style={{ width: "100%", height: "100%" }}
      >
        <NavigationControl position="top-right" showCompass={false} />

        {view === "france" && franceFc && (
          <Source id="fr" type="geojson" data={franceFc as unknown as GeoJSON.FeatureCollection}>
            {mode === "3d" ? (
              <Layer
                id="fr-ext"
                type="fill-extrusion"
                paint={{
                  "fill-extrusion-color": ["get", "fillColor"],
                  "fill-extrusion-height": ["get", "height"],
                  "fill-extrusion-base": 0,
                  "fill-extrusion-opacity": 0.92,
                }}
              />
            ) : (
              <Layer
                id="fr-fill"
                type="fill"
                paint={
                  mode === "heat"
                    // Densité : pas de choroplèthe — fond neutre uniforme, seule
                    // la heatmap porte l'information (+ contours via fr-line).
                    ? { "fill-color": "rgba(148,163,184,0.06)", "fill-opacity": 1 }
                    : { "fill-color": ["get", "fillColor"], "fill-opacity": 0.82 }
                }
              />
            )}
            <Layer id="fr-line" type="line" paint={{ "line-color": "rgba(148,163,184,0.30)", "line-width": 0.5 }} />
          </Source>
        )}

        {view === "france" && mode === "heat" && heatFc && (
          <Source id="heat" type="geojson" data={heatFc as unknown as GeoJSON.FeatureCollection}>
            <Layer
              id="fr-heat"
              type="heatmap"
              paint={{
                "heatmap-weight": ["get", "w"],
                "heatmap-intensity": 1.1,
                "heatmap-radius": 26,
                "heatmap-opacity": 0.85,
                "heatmap-color": [
                  "interpolate", ["linear"], ["heatmap-density"],
                  0, "rgba(0,0,0,0)",
                  0.2, "#4c1d95",
                  0.45, "#b45309",
                  0.7, "#f97316",
                  0.9, "#fbbf24",
                  1, "#fde68a",
                ],
              }}
            />
          </Source>
        )}

        {view === "world" && worldFc && (
          <Source id="world" type="geojson" data={worldFc as unknown as GeoJSON.FeatureCollection}>
            <Layer id="world-fill" type="fill" paint={{ "fill-color": "rgba(148,163,184,0.08)" }} />
            <Layer id="world-line" type="line" paint={{ "line-color": "rgba(148,163,184,0.18)", "line-width": 0.4 }} />
          </Source>
        )}
        {view === "world" && (
          <Source id="bubbles" type="geojson" data={bubbleFc as unknown as GeoJSON.FeatureCollection}>
            <Layer
              id="world-bubbles"
              type="circle"
              paint={{
                "circle-radius": ["get", "r"],
                "circle-color": "rgba(250,204,21,0.5)",
                "circle-stroke-color": "#facc15",
                "circle-stroke-width": 1.2,
              }}
            />
          </Source>
        )}

        {hover && (
          <Popup longitude={hover.lng} latitude={hover.lat} closeButton={false} closeOnClick={false} offset={14} className="geo-popup">
            <div className="text-[11.5px] min-w-[150px]">
              <p className="font-semibold text-foreground mb-1">{hover.zone.name}</p>
              <dl className="grid grid-cols-2 gap-x-3 gap-y-0.5 tnum">
                <dt className="text-muted-foreground">CA</dt><dd className="text-right font-medium text-foreground">{formatEuro(hover.zone.ca ?? 0, true)}</dd>
                <dt className="text-muted-foreground">Marge</dt><dd className="text-right font-medium text-foreground">{formatEuro(hover.zone.margin ?? 0, true)}</dd>
                <dt className="text-muted-foreground">Volume</dt><dd className="text-right font-medium text-foreground">{formatWeight(hover.zone.weightKg ?? 0)}</dd>
                <dt className="text-muted-foreground">BL</dt><dd className="text-right font-medium text-foreground">{formatNum(hover.zone.docs ?? 0)}</dd>
                <dt className="text-muted-foreground">Clients</dt><dd className="text-right font-medium text-foreground">{formatNum(hover.zone.clients ?? 0)}</dd>
              </dl>
            </div>
          </Popup>
        )}
      </MapGL>

      {/* Bascule 3D / Densité (France) */}
      {view === "france" && (
        <div className="absolute top-2 left-2 z-10 inline-flex items-center gap-0.5 bg-popover/90 backdrop-blur-md border border-border p-0.5 rounded-md shadow-modal">
          {(["2d", "3d", "heat"] as FranceMode[]).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setMode(m)}
              aria-pressed={mode === m}
              title={m === "2d" ? "Vue à plat (clic facile)" : m === "3d" ? "Relief 3D" : "Heatmap densité clients"}
              className={`px-2 h-6 text-[10.5px] font-semibold tracking-tight rounded transition-colors ${
                mode === m ? "bg-primary text-primary-foreground shadow-[0_0_10px_rgba(250,204,21,0.45)]" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {m === "2d" ? "2D" : m === "3d" ? "3D" : "Densité"}
            </button>
          ))}
        </div>
      )}

      <span className="sr-only">Carte {view === "france" ? "de France" : "monde"} — {geoMetricLabel(metric)}</span>
    </div>
  );
}
