"use client";

import { useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { Tile, RefreshButton, formatEuro, formatNum } from "./bento";
import { useGeoData } from "./usePilotageData";
import { BarList } from "@/components/charts/BarList";
import { Donut } from "@/components/charts/Donut";
import { GeoDrilldown, type DrillDescriptor } from "@/components/charts/GeoDrilldown";
import {
  type GeoMetric, GEO_METRICS, geoMetricLabel, geoValue, formatGeoValue, formatWeight,
  groupParisZones,
} from "@/components/charts/geoShared";

// Carte MapLibre (WebGL) — client uniquement, chargée à la volée.
const GeoMapGL = dynamic(() => import("@/components/charts/GeoMapGL").then((m) => m.GeoMapGL), {
  ssr: false,
  loading: () => <div className="h-full w-full grid place-items-center text-[12px] text-muted-foreground">Chargement de la carte…</div>,
});

const SEGMENT_COLORS: Record<string, string> = { GMS: "#38bdf8", CHR: "#10b981", EXPORT: "#a78bfa" };
const SEGMENT_LABELS: Record<string, string> = { GMS: "GMS", CHR: "CHR", EXPORT: "Export" };

/**
 * Écran 3 — Carte géographique : « où je livre le plus ».
 *
 * Source = /api/pilotage/geo (facturé 12 mois glissants, segments EXPORT+GMS+CHR
 * regroupés). Deux cartes (France choroplèthe + Monde/Outre-mer à bulles), un
 * camembert de répartition EXPORT/GMS/CHR, le top des zones et les totaux.
 * Métrique commune sélectionnable : CA / Marge / Volume / Nb de BL.
 */
export function PilotageScreen3({ viewAs = null }: { viewAs?: string | null } = {}) {
  const [refreshNonce, setRefreshNonce] = useState(0);
  const { data, err } = useGeoData(viewAs, refreshNonce);
  const [metric, setMetric] = useState<GeoMetric>("ca");
  const [drill, setDrill] = useState<DrillDescriptor | null>(null);

  // Vue nationale : la région parisienne est regroupée en « Île-de-France ».
  const groupedZones = useMemo(() => (data ? groupParisZones(data.zones) : []), [data]);

  const topZones = useMemo(
    () => groupedZones
      .map((z) => ({ z, v: geoValue(z, metric) }))
      .filter((x) => x.v > 0)
      .sort((a, b) => b.v - a.v)
      .slice(0, 8)
      .map(({ z, v }) => ({
        id: z.id,
        label: z.name,
        value: v,
        hint: `${formatNum(z.docs)} BL · ${formatNum(z.clients)} cl.`,
        color: "#facc15",
      })),
    [groupedZones, metric],
  );

  // Ouvre le drill-down depuis un clic carte (code département ou "IDF").
  const openByCode = (code: string) => {
    if (!data) return;
    if (code === "IDF") { setDrill({ kind: "idf", code: "IDF", name: "Île-de-France" }); return; }
    const z = data.zones.find((x) => x.kind === "fr-dept" && x.code === code);
    setDrill({ kind: "dept", code, name: z?.name ?? `Dép. ${code}` });
  };
  // Ouvre le drill-down depuis un clic sur une ligne du Top zones (zone id).
  const openById = (id: string) => {
    const z = groupedZones.find((x) => x.id === id);
    if (!z) return;
    if (z.code === "IDF") setDrill({ kind: "idf", code: "IDF", name: z.name });
    else if (z.kind === "fr-dept") setDrill({ kind: "dept", code: z.code, name: z.name });
    else setDrill({ kind: "country", code: z.code, name: z.name });
  };

  const donutData = useMemo(() => {
    if (!data) return [];
    return data.segments.map((s) => ({
      label: SEGMENT_LABELS[s.segment] ?? s.segment,
      value: Math.max(0, geoValue(s, metric)),
      color: SEGMENT_COLORS[s.segment],
    }));
  }, [data, metric]);

  const periodLabel = viewAs ? `Vue ${viewAs} · 12 derniers mois` : "12 derniers mois glissants";

  return (
    <div className="h-screen w-screen flex flex-col p-3 gap-3 overflow-hidden">
      <Header period={periodLabel} metric={metric} onMetric={setMetric} onRefresh={() => setRefreshNonce((n) => n + 1)} />

      {err && (
        <div className="flex-1 grid place-items-center text-[13px] text-rose-400">
          Erreur de chargement : {err}
        </div>
      )}

      {!err && (
        <main
          className="flex-1 grid gap-2 min-h-0"
          style={{ gridTemplateColumns: "repeat(12, minmax(0, 1fr))", gridTemplateRows: "repeat(6, minmax(0, 1fr))" }}
        >
          <Tile colSpan={5} rowSpan={4} title={`France · ${geoMetricLabel(metric)} · clic = détail`} accent="brand">
            <GeoMapGL view="france" zones={data?.zones ?? []} metric={metric} onZoneClick={openByCode} />
          </Tile>

          <Tile colSpan={7} rowSpan={4} title={`Outre-mer & Export · ${geoMetricLabel(metric)}`} accent="violet">
            <GeoMapGL view="world" zones={data?.zones ?? []} metric={metric} />
          </Tile>

          <Tile colSpan={3} rowSpan={2} title="Répartition EXPORT / GMS / CHR" accent="emerald">
            <div className="h-full flex items-center justify-center">
              {donutData.some((d) => d.value > 0) ? (
                <Donut
                  size={132}
                  thickness={16}
                  centerValue={formatGeoValue(metric, data?.totals ? geoValue(data.totals, metric) : 0)}
                  centerLabel={GEO_METRICS.find((m) => m.id === metric)?.short}
                  data={donutData}
                  aria-label="Répartition EXPORT / GMS / CHR"
                />
              ) : (
                <p className="text-[12px] italic text-muted-foreground">Aucune donnée.</p>
              )}
            </div>
          </Tile>

          <Tile colSpan={5} rowSpan={2} title={`Top zones · ${geoMetricLabel(metric)} · clic = détail`} accent="amber">
            <BarList items={topZones} max={8} format={(v) => formatGeoValue(metric, v)} className="space-y-0.5" onSelect={openById} />
          </Tile>

          <Tile colSpan={4} rowSpan={2} title="Total livré · 12 mois">
            <TotalsPanel data={data} />
          </Tile>
        </main>
      )}

      {drill && data && (
        <GeoDrilldown
          descriptor={drill}
          clients={data.clients}
          metric={metric}
          onClose={() => setDrill(null)}
        />
      )}
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────
   Totaux + part non localisée.
   ───────────────────────────────────────────────────────────────── */
function TotalsPanel({ data }: { data: ReturnType<typeof useGeoData>["data"] }) {
  if (!data) {
    return <div className="h-full grid place-items-center text-[12px] text-muted-foreground">Chargement…</div>;
  }
  const t = data.totals;
  const stats: { label: string; value: string }[] = [
    { label: "CA facturé", value: formatEuro(t.ca, true) },
    { label: "Marge", value: formatEuro(t.margin, true) },
    { label: "Volume", value: formatWeight(t.weightKg) },
    { label: "BL", value: formatNum(t.docs) },
    { label: "Clients", value: formatNum(t.clients) },
    { label: "Zones", value: formatNum(data.zones.length) },
  ];
  const unlocatedPct = t.ca > 0 ? (data.unlocated.ca / t.ca) * 100 : 0;
  return (
    <div className="h-full flex flex-col justify-between">
      <div className="grid grid-cols-3 gap-2">
        {stats.map((s) => (
          <div key={s.label} className="rounded-lg bg-secondary/40 px-2.5 py-2">
            <p className="text-[9.5px] uppercase tracking-[0.12em] text-muted-foreground">{s.label}</p>
            <p className="text-[15px] font-semibold text-foreground tnum leading-tight mt-0.5">{s.value}</p>
          </div>
        ))}
      </div>
      {data.unlocated.clients > 0 && (
        <p className="text-[10.5px] text-muted-foreground mt-2">
          {formatNum(data.unlocated.clients)} client(s) non localisé(s)
          {unlocatedPct >= 0.5 ? ` · ${unlocatedPct.toFixed(0)} % du CA` : ""} — adresse SAP manquante.
        </p>
      )}
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────
   Header — titre + sélecteur de métrique (CA / Marge / Volume / BL).
   ───────────────────────────────────────────────────────────────── */
function Header({
  period, metric, onMetric, onRefresh,
}: { period: string; metric: GeoMetric; onMetric: (m: GeoMetric) => void; onRefresh: () => void }) {
  const [now, setNow] = useState("");
  useEffect(() => {
    const tick = () => setNow(new Date().toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" }));
    tick();
    const id = setInterval(tick, 30_000);
    return () => clearInterval(id);
  }, []);
  return (
    <header className="shrink-0 flex items-center justify-between gap-4 pl-36 pr-2">
      <div className="flex items-baseline gap-3 min-w-0">
        <p className="text-[10.5px] uppercase tracking-[0.18em] font-bold text-muted-foreground shrink-0">
          Carte · Où je livre le plus
        </p>
        <h1 className="text-[15px] font-semibold tracking-tight text-foreground truncate">{period}</h1>
      </div>
      <div className="flex items-center gap-3">
        <span className="text-[11px] text-muted-foreground tnum">{now}</span>
        <MetricToggle value={metric} onChange={onMetric} />
        <RefreshButton onClick={onRefresh} title="Actualiser la géoloc et les données" />
      </div>
    </header>
  );
}

function MetricToggle({ value, onChange }: { value: GeoMetric; onChange: (m: GeoMetric) => void }) {
  return (
    <div className="inline-flex items-center gap-0.5 bg-secondary/60 p-0.5 rounded-md">
      {GEO_METRICS.map((m) => (
        <button
          key={m.id}
          type="button"
          onClick={() => onChange(m.id)}
          aria-pressed={value === m.id}
          className={`px-2.5 h-7 text-[11.5px] font-semibold tracking-tight rounded transition-colors ${
            value === m.id ? "bg-primary text-primary-foreground shadow-[0_0_10px_rgba(250,204,21,0.45)]" : "text-muted-foreground hover:text-foreground"
          }`}
        >
          {m.short}
        </button>
      ))}
    </div>
  );
}
