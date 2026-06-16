"use client";

/**
 * Helpers partagés par les cartes géo (FranceChoropleth + WorldBubbleMap) et
 * l'écran 3. Métriques sélectionnables : CA, marge, poids, nb de BL.
 */

import type { GeoZone } from "@/lib/pilotageGeo";
import { formatEuro, formatNum } from "@/components/pilotage/bento";

export type GeoMetric = "ca" | "margin" | "weightKg" | "docs";

export const GEO_METRICS: { id: GeoMetric; label: string; short: string }[] = [
  { id: "ca", label: "CA facturé", short: "CA" },
  { id: "margin", label: "Marge €", short: "Marge" },
  { id: "weightKg", label: "Volume", short: "Volume" },
  { id: "docs", label: "Nb de BL", short: "BL" },
];

export function geoMetricLabel(m: GeoMetric): string {
  return GEO_METRICS.find((x) => x.id === m)?.label ?? m;
}

export function geoValue(z: Pick<GeoZone, GeoMetric>, m: GeoMetric): number {
  return z[m] ?? 0;
}

/* ─────────────────────────────────────────────────────────────────
   Île-de-France — les 8 départements franciliens. Sur la carte nationale
   ils sont minuscules et illisibles → on les REGROUPE en une zone unique
   « Île-de-France », et on détaille la région sur une carte zoomée dédiée.
   ───────────────────────────────────────────────────────────────── */
export const IDF_CODES = ["75", "77", "78", "91", "92", "93", "94", "95"];
const IDF_SET = new Set(IDF_CODES);
export const isIDF = (code: string) => IDF_SET.has(code);

/** Fusionne les 8 départements franciliens en une zone « Île-de-France ».
 *  Utilisé pour la liste Top zones (vue nationale regroupée). */
export function groupParisZones(zones: GeoZone[]): GeoZone[] {
  const idf = zones.filter((z) => z.kind === "fr-dept" && isIDF(z.code));
  if (idf.length === 0) return zones;
  const sum = (k: GeoMetric) => idf.reduce((s, z) => s + (z[k] ?? 0), 0);
  const merged: GeoZone = {
    id: "fr-IDF", kind: "fr-dept", code: "IDF", name: "Île-de-France", lat: null, lng: null,
    ca: sum("ca"), margin: sum("margin"), weightKg: sum("weightKg"), docs: sum("docs"),
    clients: idf.reduce((s, z) => s + z.clients, 0),
  };
  return [...zones.filter((z) => !(z.kind === "fr-dept" && isIDF(z.code))), merged];
}

/** Agrégat « Île-de-France » seul (ou null si aucune donnée IDF). */
export function parisAggregate(zones: GeoZone[]): GeoZone | null {
  return groupParisZones(zones).find((z) => z.code === "IDF") ?? null;
}

export function formatWeight(kg: number): string {
  if (Math.abs(kg) >= 1000) return `${(kg / 1000).toLocaleString("fr-FR", { maximumFractionDigits: 1 })} t`;
  return `${Math.round(kg).toLocaleString("fr-FR")} kg`;
}

/** Formate une valeur selon la métrique active (compact). */
export function formatGeoValue(m: GeoMetric, v: number): string {
  if (m === "ca" || m === "margin") return formatEuro(v, true);
  if (m === "weightKg") return formatWeight(v);
  return formatNum(v);
}

/** Rampe mono-teinte brand (cohérente avec la Heatmap du dashboard) sur fond sombre. */
export function brandHeat(intensity: number): string {
  const t = Math.max(0, Math.min(1, intensity));
  return `rgba(250, 204, 21, ${0.16 + t * 0.78})`;
}

/* ─────────────────────────────────────────────────────────────────
   Carte tooltip — nom de zone + les 4 métriques. Utilisée par les deux
   cartes via un overlay positionné.
   ───────────────────────────────────────────────────────────────── */
export function ZoneTooltipCard({ zone }: { zone: GeoZone }) {
  return (
    <div className="pointer-events-none rounded-lg border border-border bg-popover/95 backdrop-blur-md shadow-modal px-3 py-2 text-[11.5px] min-w-[150px]">
      <div className="font-semibold text-foreground mb-1 flex items-center gap-1.5">
        <span className="truncate">{zone.name}</span>
        <span className="text-[9.5px] uppercase tracking-wide text-muted-foreground">
          {zone.kind === "country" ? zone.code : `dép. ${zone.code}`}
        </span>
      </div>
      <dl className="grid grid-cols-2 gap-x-3 gap-y-0.5 tnum">
        <dt className="text-muted-foreground">CA</dt>
        <dd className="text-right font-medium text-foreground">{formatEuro(zone.ca, true)}</dd>
        <dt className="text-muted-foreground">Marge</dt>
        <dd className="text-right font-medium text-foreground">{formatEuro(zone.margin, true)}</dd>
        <dt className="text-muted-foreground">Volume</dt>
        <dd className="text-right font-medium text-foreground">{formatWeight(zone.weightKg)}</dd>
        <dt className="text-muted-foreground">BL</dt>
        <dd className="text-right font-medium text-foreground">{formatNum(zone.docs)}</dd>
        <dt className="text-muted-foreground">Clients</dt>
        <dd className="text-right font-medium text-foreground">{formatNum(zone.clients)}</dd>
      </dl>
    </div>
  );
}

/** Charge un GeoJSON statique (public/geo) une seule fois (cache module). */
const geoCache = new Map<string, Promise<{ features: GeoFeature[] }>>();
export interface GeoFeature {
  type: "Feature";
  properties: Record<string, string>;
  geometry: { type: string; coordinates: unknown };
}
export function loadGeo(url: string): Promise<{ features: GeoFeature[] }> {
  let p = geoCache.get(url);
  if (!p) {
    p = fetch(url).then((r) => r.json());
    geoCache.set(url, p);
  }
  return p;
}
