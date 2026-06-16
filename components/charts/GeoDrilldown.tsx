"use client";

import { useEffect, useMemo, useState } from "react";
import { X } from "lucide-react";
import type { GeoClient } from "@/lib/pilotageGeo";
import { FranceChoropleth } from "./FranceChoropleth";
import {
  type GeoMetric, type MapPoint, geoValue, geoMetricLabel, formatGeoValue, loadCp, IDF_CODES,
} from "./geoShared";

export interface DrillDescriptor {
  kind: "dept" | "idf" | "country";
  code: string;   // "75" | "IDF" | "MV"
  name: string;   // "Paris" | "Île-de-France" | "Maldives"
}

/**
 * Drill-down d'une zone : ouvre la carte du département (ou région IDF) avec
 * les CLIENTS livrés en bulles proportionnelles à la métrique, + la liste
 * détaillée. Pour l'export (pays), pas de sous-carte → liste seule.
 */
export function GeoDrilldown({
  descriptor, clients, metric, onClose,
}: {
  descriptor: DrillDescriptor;
  clients: GeoClient[];
  metric: GeoMetric;
  onClose: () => void;
}) {
  const [cp, setCp] = useState<Record<string, [number, number]> | null>(null);
  const isFr = descriptor.kind === "dept" || descriptor.kind === "idf";

  useEffect(() => {
    if (!isFr) return;
    let on = true;
    loadCp().then((m) => { if (on) setCp(m); });
    return () => { on = false; };
  }, [isFr]);

  // Fermeture au clavier (Échap).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Clients de la zone, triés par métrique décroissante.
  const zoneClients = useMemo(() => {
    const inZone = (c: GeoClient) =>
      descriptor.kind === "idf" ? c.kind === "fr-dept" && c.code != null && IDF_CODES.includes(c.code)
      : descriptor.kind === "dept" ? c.kind === "fr-dept" && c.code === descriptor.code
      : c.kind === "country" && c.code === descriptor.code;
    return clients.filter(inZone).sort((a, b) => geoValue(b, metric) - geoValue(a, metric));
  }, [clients, descriptor, metric]);

  // Bulles : clients géolocalisés par code postal (FR uniquement).
  const points: MapPoint[] = useMemo(() => {
    if (!cp) return [];
    const out: MapPoint[] = [];
    for (const c of zoneClients) {
      const v = geoValue(c, metric);
      const xy = c.zip ? cp[c.zip] : undefined;
      if (!xy || v <= 0) continue;
      out.push({
        id: c.cardCode,
        lng: xy[0],
        lat: xy[1],
        value: v,
        label: c.name,
        sub: `${c.city ?? c.zip ?? ""} · ${formatGeoValue(metric, v)}`.trim(),
      });
    }
    return out;
  }, [cp, zoneClients, metric]);

  const onlyCodes = descriptor.kind === "idf" ? IDF_CODES : [descriptor.code];
  const located = points.length;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4 sm:p-8"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={`Détail ${descriptor.name}`}
    >
      <div
        className="bg-card border border-border rounded-2xl shadow-modal w-full max-w-4xl h-[82vh] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="shrink-0 flex items-center justify-between gap-3 px-4 py-3 border-b border-border">
          <div className="min-w-0">
            <p className="text-[10px] uppercase tracking-[0.16em] font-bold text-muted-foreground">
              {descriptor.kind === "country" ? "Pays export" : descriptor.kind === "idf" ? "Région" : "Département"} · {geoMetricLabel(metric)}
            </p>
            <h2 className="text-[17px] font-semibold text-foreground truncate">
              {descriptor.name}
              <span className="ml-2 text-[12px] font-normal text-muted-foreground">
                {zoneClients.length} client{zoneClients.length > 1 ? "s" : ""}
              </span>
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fermer"
            className="shrink-0 h-8 w-8 rounded-lg bg-secondary/60 text-muted-foreground hover:text-foreground hover:bg-secondary flex items-center justify-center transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className={`flex-1 min-h-0 grid ${isFr ? "grid-cols-1 md:grid-cols-[1.4fr_1fr]" : "grid-cols-1"}`}>
          {isFr && (
            <div className="relative min-h-0 border-b md:border-b-0 md:border-r border-border p-2">
              <FranceChoropleth zones={[]} metric={metric} onlyCodes={onlyCodes} points={points} />
              <p className="absolute bottom-2 left-3 text-[10px] text-muted-foreground">
                {located} / {zoneClients.length} client(s) localisé(s) · taille ∝ {geoMetricLabel(metric)}
              </p>
            </div>
          )}

          <ol className="overflow-y-auto min-h-0 p-2">
            {zoneClients.map((c, i) => (
              <li key={c.cardCode} className="grid grid-cols-[20px_1fr_auto] items-center gap-2 px-2 py-1.5 rounded-md hover:bg-secondary/40">
                <span className="text-[11px] text-muted-foreground/70 tnum text-right">{i + 1}</span>
                <div className="min-w-0">
                  <p className="text-[12.5px] font-medium text-foreground truncate">{c.name}</p>
                  <p className="text-[10.5px] text-muted-foreground truncate">
                    {[c.city, c.zip].filter(Boolean).join(" · ") || "—"}
                  </p>
                </div>
                <span className="text-[12.5px] font-semibold tnum text-foreground whitespace-nowrap">
                  {formatGeoValue(metric, geoValue(c, metric))}
                </span>
              </li>
            ))}
            {zoneClients.length === 0 && (
              <li className="text-[12px] text-muted-foreground italic py-4 text-center">Aucun client sur la période.</li>
            )}
          </ol>
        </div>
      </div>
    </div>
  );
}
