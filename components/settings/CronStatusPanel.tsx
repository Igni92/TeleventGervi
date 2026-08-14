"use client";

import { useCallback, useEffect, useState } from "react";
import { RefreshCw, CheckCircle2, XCircle, AlertTriangle, Clock } from "lucide-react";

/* Miroir de /api/admin/cron-status. */
interface CronRow {
  name: string;
  label: string;
  cadence: string;
  path: string;
  lastRun: string | null;
  ok: boolean | null;
  durationMs: number | null;
  detail: string | null;
}

/** Fenêtre de « fraîcheur » par cron (ms) : au-delà, on soupçonne un blocage. */
const STALE_MS: Record<string, number> = {
  "sap-sync": 3 * 60 * 60 * 1000,       // attendu toutes les 30 min → alerte à 3 h
  "legal-rate": 3 * 24 * 60 * 60 * 1000, // 1×/jour → alerte à 3 j
};

function relTime(iso: string, nowMs: number): string {
  const diff = nowMs - new Date(iso).getTime();
  const min = Math.round(diff / 60000);
  if (min < 1) return "à l'instant";
  if (min < 60) return `il y a ${min} min`;
  const h = Math.round(min / 60);
  if (h < 48) return `il y a ${h} h`;
  return `il y a ${Math.round(h / 24)} j`;
}

const fmtDate = (iso: string) =>
  new Date(iso).toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" });

export function CronStatusPanel() {
  const [rows, setRows] = useState<CronRow[] | null>(null);
  const [now, setNow] = useState<number>(0);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const r = await fetch("/api/admin/cron-status", { cache: "no-store" });
      const j = await r.json();
      if (!r.ok || !j.ok) throw new Error(j.error || "Chargement impossible");
      setRows(j.crons);
      setNow(new Date(j.now).getTime());
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <p className="text-[12px] text-muted-foreground max-w-xl">
          Dernier passage de chaque tâche automatique. Les logs système du cron n&apos;étant pas visibles sur ce serveur,
          c&apos;est ici qu&apos;on vérifie qu&apos;elles tournent.
        </p>
        <button
          type="button"
          onClick={load}
          disabled={loading}
          className="shrink-0 inline-flex items-center gap-1.5 h-8 px-3 rounded-lg border border-border text-[12px] font-semibold text-muted-foreground hover:text-foreground hover:bg-secondary/60 transition-colors disabled:opacity-60"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} /> Actualiser
        </button>
      </div>

      {err && (
        <div className="rounded-lg border border-rose-400/50 bg-rose-50 dark:bg-rose-950/25 px-3 py-2 text-[12.5px] text-rose-700 dark:text-rose-300">
          {err}
        </div>
      )}

      <div className="flex flex-col divide-y divide-border/50">
        {(rows ?? []).map((c) => {
          const never = !c.lastRun;
          const stale = !never && now - new Date(c.lastRun!).getTime() > (STALE_MS[c.name] ?? 24 * 3600 * 1000);
          const state: "never" | "fail" | "stale" | "ok" =
            never ? "never" : c.ok === false ? "fail" : stale ? "stale" : "ok";
          const badge = {
            never: { icon: <Clock className="h-3.5 w-3.5" />, cls: "text-muted-foreground bg-secondary", txt: "Jamais exécuté" },
            fail: { icon: <XCircle className="h-3.5 w-3.5" />, cls: "text-rose-700 dark:text-rose-300 bg-rose-500/15", txt: "Échec" },
            stale: { icon: <AlertTriangle className="h-3.5 w-3.5" />, cls: "text-amber-700 dark:text-amber-300 bg-amber-500/15", txt: "Peut-être bloqué" },
            ok: { icon: <CheckCircle2 className="h-3.5 w-3.5" />, cls: "text-emerald-700 dark:text-emerald-300 bg-emerald-500/15", txt: "OK" },
          }[state];
          return (
            <div key={c.name} className="flex flex-col gap-1.5 py-3 first:pt-1 last:pb-1 sm:flex-row sm:items-center sm:justify-between sm:gap-6">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <p className="text-[13.5px] font-semibold text-foreground">{c.label}</p>
                  <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10.5px] font-semibold ${badge.cls}`}>
                    {badge.icon} {badge.txt}
                  </span>
                </div>
                <p className="text-[11.5px] text-muted-foreground mt-0.5">
                  {c.cadence} · <span className="font-mono">{c.path}</span>
                  {c.detail && <> — {c.detail}</>}
                </p>
              </div>
              <div className="shrink-0 text-right">
                {c.lastRun ? (
                  <>
                    <p className="text-[12.5px] font-medium text-foreground tabular-nums">{fmtDate(c.lastRun)}</p>
                    <p className="text-[11px] text-muted-foreground">{relTime(c.lastRun, now)}{c.durationMs ? ` · ${(c.durationMs / 1000).toFixed(1)} s` : ""}</p>
                  </>
                ) : (
                  <p className="text-[12px] text-muted-foreground">—</p>
                )}
              </div>
            </div>
          );
        })}
        {rows && rows.length === 0 && (
          <p className="py-3 text-[12.5px] text-muted-foreground">Aucune tâche planifiée connue.</p>
        )}
      </div>
    </div>
  );
}
