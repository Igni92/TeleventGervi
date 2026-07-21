"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Activity, Loader2, RotateCcw, Monitor, Smartphone, Tablet, HelpCircle,
  MousePointerClick, Clock, Users, Bug, AlertTriangle, Gauge, Timer,
} from "lucide-react";
import { SurfaceCard } from "@/components/ui/surface-card";
import { BarList } from "@/components/charts/BarList";
import { Donut } from "@/components/charts/Donut";
import { CHART } from "@/components/charts/theme";
import { cn } from "@/lib/utils";

/**
 * Écran d'AUDIT D'USAGE (Paramètres → admin/direction). Lit /api/usage/report
 * et visualise : temps + clics par écran, répartition PC / mobile, et les
 * problèmes (erreurs JS, rage-clicks, clics morts, interactions lentes).
 *
 * Purement défensif : si les tables sont vides (tracking récent) ou l'API
 * échoue, on affiche un état vide clair — jamais d'erreur bloquante.
 */

type DeviceRow = { deviceType: string; views: number; totalMs: number };
type ScreenRow = { screen: string; visits: number; totalMs: number; avgMs: number; avgActiveMs: number; clicks: number; avgScroll: number };
type ProblemRow = { screen: string; errors: number; rage: number; dead: number; slow: number; worstInp: number };
type ErrorRow = { type: string; screen: string; message: string; count: number };
type UserRow = { userEmail: string; visits: number; totalMs: number };

interface Report {
  days: number;
  totals: { views: number; sessions: number; users: number; totalMs: number; activeMs: number; clicks: number; errors: number; rage: number };
  devices: DeviceRow[];
  browsers: { browser: string; views: number }[];
  screens: ScreenRow[];
  problems: ProblemRow[];
  topErrors: ErrorRow[];
  byUser: UserRow[];
}

const PERIODS = [7, 30, 90] as const;

const nf = new Intl.NumberFormat("fr-FR");
const fmtNum = (v: number) => nf.format(Math.round(v));
function fmtDur(ms: number): string {
  const s = Math.round((ms || 0) / 1000);
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  return `${h} h ${String(m % 60).padStart(2, "0")}`;
}

const DEVICE_META: Record<string, { label: string; color: string; icon: React.ReactNode }> = {
  desktop: { label: "PC (bureau)", color: CHART.info, icon: <Monitor className="h-3.5 w-3.5" /> },
  mobile: { label: "Mobile", color: CHART.positive, icon: <Smartphone className="h-3.5 w-3.5" /> },
  tablet: { label: "Tablette", color: CHART.violet, icon: <Tablet className="h-3.5 w-3.5" /> },
};
const deviceMeta = (t: string) =>
  DEVICE_META[t] ?? { label: "Inconnu", color: "#94a3b8", icon: <HelpCircle className="h-3.5 w-3.5" /> };

const ERROR_TYPE_LABEL: Record<string, string> = {
  error: "Erreur JS",
  unhandled_rejection: "Promesse rejetée",
  resource_error: "Ressource",
};

/* ── Petite tuile KPI ── */
function Kpi({ icon, label, value, sub }: { icon: React.ReactNode; label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-lg border border-border/60 bg-secondary/30 px-3 py-2.5">
      <div className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        {icon}
        <span className="truncate">{label}</span>
      </div>
      <p className="mt-1 text-[19px] font-bold tnum text-foreground leading-none">{value}</p>
      {sub && <p className="mt-1 text-[11px] text-muted-foreground">{sub}</p>}
    </div>
  );
}

/* ── Cellule numérique colorée du tableau des problèmes ── */
function Cell({ v, tone }: { v: number; tone: "err" | "warn" | "info" | "muted" }) {
  const cls =
    v === 0
      ? "text-muted-foreground/50"
      : tone === "err"
        ? "text-rose-500 dark:text-rose-400 font-semibold"
        : tone === "warn"
          ? "text-amber-600 dark:text-amber-400 font-semibold"
          : tone === "info"
            ? "text-sky-600 dark:text-sky-400 font-semibold"
            : "text-foreground";
  return <td className={cn("px-2 py-1.5 text-right tnum text-[12px]", cls)}>{v === 0 ? "—" : fmtNum(v)}</td>;
}

export function UsageAuditPanel() {
  const [days, setDays] = useState<(typeof PERIODS)[number]>(30);
  const [data, setData] = useState<Report | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback((d: number, signal?: AbortSignal) => {
    setLoading(true);
    setError(null);
    fetch(`/api/usage/report?days=${d}`, { cache: "no-store", signal })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(r.status === 403 ? "Accès réservé" : "Erreur serveur"))))
      .then((j: Report) => setData(j))
      .catch((e) => { if ((e as Error).name !== "AbortError") setError((e as Error).message); })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    const ctrl = new AbortController();
    load(days, ctrl.signal);
    return () => ctrl.abort();
  }, [days, load]);

  const t = data?.totals;
  const empty = !!data && (t?.views ?? 0) === 0;

  const periodSelector = (
    <div className="flex items-center gap-1">
      <div role="radiogroup" aria-label="Période" className="inline-flex items-center gap-0.5 bg-secondary/60 p-0.5 rounded-lg">
        {PERIODS.map((p) => (
          <button
            key={p}
            type="button"
            role="radio"
            aria-checked={days === p}
            onClick={() => setDays(p)}
            className={cn(
              "px-2.5 h-7 text-[12px] font-semibold rounded-md transition-colors",
              days === p ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {p} j
          </button>
        ))}
      </div>
      <button
        type="button"
        onClick={() => load(days)}
        title="Rafraîchir"
        className="h-7 w-7 inline-flex items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-secondary/60 transition-colors"
      >
        {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RotateCcw className="h-3.5 w-3.5" />}
      </button>
    </div>
  );

  const deviceData = (data?.devices ?? []).map((d) => ({ label: deviceMeta(d.deviceType).label, value: d.views, color: deviceMeta(d.deviceType).color }));
  const screensByTime = (data?.screens ?? []).map((s) => ({ label: s.screen, value: s.totalMs, hint: `${fmtNum(s.visits)} visites` }));
  const screensByClicks = [...(data?.screens ?? [])]
    .sort((a, b) => b.clicks - a.clicks)
    .map((s) => ({ label: s.screen, value: s.clicks, hint: `${fmtDur(s.avgMs)}/visite` }));
  const usersByTime = (data?.byUser ?? []).map((u) => ({ label: u.userEmail, value: u.totalMs, hint: `${fmtNum(u.visits)} visites` }));

  return (
    <div className="space-y-5">
      {/* Vue d'ensemble */}
      <SurfaceCard accent="brand" title="Usage & audit" icon={<Activity className="h-3.5 w-3.5" />} action={periodSelector}>
        <p className="text-[12px] text-muted-foreground -mt-1 mb-3 max-w-2xl">
          Temps passé et clics sur chaque écran, appareil utilisé et problèmes rencontrés — sur les {days} derniers jours.
          Alimenté automatiquement dès qu&apos;un écran est ouvert.
        </p>

        {error ? (
          <p className="text-[12.5px] text-rose-500 py-4">Impossible de charger le rapport : {error}.</p>
        ) : !data ? (
          <p className="flex items-center gap-2 text-[12.5px] text-muted-foreground py-4"><Loader2 className="h-4 w-4 animate-spin" /> Chargement…</p>
        ) : empty ? (
          <p className="text-[12.5px] text-muted-foreground py-4">
            Aucune donnée d&apos;usage sur la période. Le suivi vient d&apos;être activé — les statistiques apparaîtront dès les prochaines navigations.
          </p>
        ) : (
          <>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2.5">
              <Kpi icon={<Activity className="h-3 w-3" />} label="Visites d'écran" value={fmtNum(t!.views)} sub={`${fmtNum(t!.sessions)} sessions`} />
              <Kpi icon={<Users className="h-3 w-3" />} label="Utilisateurs" value={fmtNum(t!.users)} />
              <Kpi icon={<Clock className="h-3 w-3" />} label="Temps total" value={fmtDur(t!.totalMs)} sub={`dont ${fmtDur(t!.activeMs)} actif`} />
              <Kpi icon={<MousePointerClick className="h-3 w-3" />} label="Clics" value={fmtNum(t!.clicks)} />
              <Kpi icon={<Bug className="h-3 w-3" />} label="Erreurs JS" value={fmtNum(t!.errors)} />
              <Kpi icon={<AlertTriangle className="h-3 w-3" />} label="Rage-clicks" value={fmtNum(t!.rage)} />
            </div>

            <div className="mt-5 grid gap-5 md:grid-cols-2">
              <div>
                <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Appareils (PC vs mobile)</p>
                <Donut
                  data={deviceData}
                  size={132}
                  centerValue={fmtNum(t!.views)}
                  centerLabel="vues"
                  format={(v) => `${fmtNum(v)} vues`}
                  aria-label="Répartition des visites par type d'appareil"
                />
              </div>
              <div>
                <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Navigateurs</p>
                <BarList
                  items={(data.browsers ?? []).map((b) => ({ label: b.browser, value: b.views }))}
                  format={(v) => `${fmtNum(v)}`}
                  max={6}
                />
              </div>
            </div>
          </>
        )}
      </SurfaceCard>

      {/* Temps & clics par écran */}
      {data && !empty && !error && (
        <SurfaceCard accent="sky" title="Temps & clics par écran" icon={<Timer className="h-3.5 w-3.5" />}>
          <div className="grid gap-6 md:grid-cols-2">
            <div>
              <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Temps total passé</p>
              <BarList items={screensByTime} format={fmtDur} max={12} />
            </div>
            <div>
              <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Nombre de clics</p>
              <BarList items={screensByClicks} format={fmtNum} max={12} />
            </div>
          </div>
        </SurfaceCard>
      )}

      {/* Problèmes détectés */}
      {data && !empty && !error && (
        <SurfaceCard accent="rose" title="Problèmes détectés" icon={<AlertTriangle className="h-3.5 w-3.5" />}>
          {data.problems.length === 0 ? (
            <p className="text-[12.5px] text-muted-foreground py-2">Aucun problème détecté sur la période 🎉</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-[12px]">
                <thead>
                  <tr className="text-[10.5px] uppercase tracking-wide text-muted-foreground border-b border-border/60">
                    <th className="px-2 py-1.5 text-left font-semibold">Écran</th>
                    <th className="px-2 py-1.5 text-right font-semibold" title="Erreurs JavaScript">Erreurs</th>
                    <th className="px-2 py-1.5 text-right font-semibold" title="Rafales de clics = frustration">Rage</th>
                    <th className="px-2 py-1.5 text-right font-semibold" title="Clics hors élément interactif">Clics morts</th>
                    <th className="px-2 py-1.5 text-right font-semibold" title="Interactions au-delà de 200 ms">Lenteurs</th>
                    <th className="px-2 py-1.5 text-right font-semibold" title="Pire latence d'interaction (INP-like)">Pire INP</th>
                  </tr>
                </thead>
                <tbody>
                  {data.problems.map((p) => (
                    <tr key={p.screen} className="border-b border-border/40 last:border-0 hover:bg-secondary/40 transition-colors">
                      <td className="px-2 py-1.5 text-left text-foreground/90 max-w-[220px] truncate">{p.screen}</td>
                      <Cell v={p.errors} tone="err" />
                      <Cell v={p.rage} tone="warn" />
                      <Cell v={p.dead} tone="warn" />
                      <Cell v={p.slow} tone="info" />
                      <td className={cn("px-2 py-1.5 text-right tnum text-[12px]", p.worstInp > 500 ? "text-rose-500 dark:text-rose-400 font-semibold" : p.worstInp > 0 ? "text-foreground" : "text-muted-foreground/50")}>
                        {p.worstInp > 0 ? `${fmtNum(p.worstInp)} ms` : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {data.topErrors.length > 0 && (
            <div className="mt-4 border-t border-border/50 pt-3">
              <p className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                <Bug className="h-3.5 w-3.5" /> Messages d&apos;erreur les plus fréquents
              </p>
              <ul className="space-y-1">
                {data.topErrors.map((e, i) => (
                  <li key={i} className="flex items-start gap-2 text-[12px] rounded-md px-2 py-1 hover:bg-secondary/40 transition-colors">
                    <span className="shrink-0 tnum font-semibold text-rose-500 dark:text-rose-400 w-9 text-right">{fmtNum(e.count)}×</span>
                    <span className="shrink-0 rounded bg-secondary/70 px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">{ERROR_TYPE_LABEL[e.type] ?? e.type}</span>
                    <span className="shrink-0 text-[11px] text-muted-foreground max-w-[130px] truncate">{e.screen}</span>
                    <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-foreground/80" title={e.message}>{e.message || "(sans message)"}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </SurfaceCard>
      )}

      {/* Usage par utilisateur */}
      {data && !empty && !error && usersByTime.length > 0 && (
        <SurfaceCard accent="violet" title="Usage par utilisateur" icon={<Users className="h-3.5 w-3.5" />}>
          <BarList items={usersByTime} format={fmtDur} max={12} />
          <p className="mt-3 flex items-center gap-1.5 text-[11px] text-muted-foreground/80">
            <Gauge className="h-3.5 w-3.5 shrink-0" />
            Temps total passé dans l&apos;app, par compte (email professionnel).
          </p>
        </SurfaceCard>
      )}
    </div>
  );
}
