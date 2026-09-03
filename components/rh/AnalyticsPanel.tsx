"use client";

import { useEffect, useState } from "react";
import { Loader2, Users, TrendingDown, LogIn, LogOut, Clock, Plane } from "lucide-react";

type State = {
  stats: { effectif: number; sortis: number; entrees12m: number; sorties12m: number; turnoverPct: number; ancienneteMoy: number | null; absenceJours: number };
  months: { key: string; label: string; entrees: number; sorties: number }[];
  contractMix: { type: string; n: number }[];
};

export function AnalyticsPanel() {
  const [s, setS] = useState<State | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    (async () => {
      try { const r = await fetch("/api/rh/analytics", { cache: "no-store" }); const j = await r.json(); if (r.ok && j.ok) setS(j); }
      finally { setLoading(false); }
    })();
  }, []);

  if (loading) return <div className="flex justify-center py-20"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;
  if (!s) return <p className="text-center text-muted-foreground py-16">Analytics indisponible.</p>;

  const maxMonth = Math.max(1, ...s.months.map((m) => Math.max(m.entrees, m.sorties)));
  const maxMix = Math.max(1, ...s.contractMix.map((c) => c.n));

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Kpi icon={<Users className="h-4 w-4" />} label="Effectif actif" value={String(s.stats.effectif)} />
        <Kpi icon={<TrendingDown className="h-4 w-4" />} label="Turnover (12 mois)" value={`${s.stats.turnoverPct} %`} tone={s.stats.turnoverPct > 20 ? "text-rose-600 dark:text-rose-400" : "text-foreground"} />
        <Kpi icon={<Clock className="h-4 w-4" />} label="Ancienneté moy." value={s.stats.ancienneteMoy != null ? `${s.stats.ancienneteMoy} ans` : "—"} />
        <Kpi icon={<Plane className="h-4 w-4" />} label="Congés pris (12 m)" value={`${s.stats.absenceJours} j`} />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Entrées / Sorties mensuelles */}
        <div className="rounded-xl border border-border bg-card p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-[13px] font-semibold text-foreground">Mouvements (12 mois)</h3>
            <div className="flex items-center gap-3 text-[11px]">
              <span className="inline-flex items-center gap-1 text-emerald-600 dark:text-emerald-400"><LogIn className="h-3 w-3" /> {s.stats.entrees12m} entrées</span>
              <span className="inline-flex items-center gap-1 text-rose-600 dark:text-rose-400"><LogOut className="h-3 w-3" /> {s.stats.sorties12m} sorties</span>
            </div>
          </div>
          <div className="flex items-end gap-1.5 h-32">
            {s.months.map((m) => (
              <div key={m.key} className="flex-1 flex flex-col items-center justify-end gap-0.5 h-full">
                <div className="flex items-end gap-0.5 w-full justify-center h-full">
                  <div className="w-1/2 rounded-t bg-emerald-500/70" style={{ height: `${(m.entrees / maxMonth) * 100}%` }} title={`${m.entrees} entrées`} />
                  <div className="w-1/2 rounded-t bg-rose-500/70" style={{ height: `${(m.sorties / maxMonth) * 100}%` }} title={`${m.sorties} sorties`} />
                </div>
                <span className="text-[9px] text-muted-foreground">{m.label}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Répartition contrats */}
        <div className="rounded-xl border border-border bg-card p-4">
          <h3 className="text-[13px] font-semibold text-foreground mb-3">Répartition des contrats actifs</h3>
          <ul className="space-y-2">
            {s.contractMix.map((c) => (
              <li key={c.type} className="flex items-center gap-3">
                <span className="w-24 text-[12px] font-medium text-foreground shrink-0">{c.type}</span>
                <div className="flex-1 h-5 rounded bg-secondary overflow-hidden">
                  <div className="h-full rounded bg-brand-500" style={{ width: `${(c.n / maxMix) * 100}%` }} />
                </div>
                <span className="w-8 text-right text-[12px] tnum text-muted-foreground">{c.n}</span>
              </li>
            ))}
            {s.contractMix.length === 0 && <li className="text-[13px] text-muted-foreground">Aucun contrat actif.</li>}
          </ul>
        </div>
      </div>

      <p className="text-center text-[12px] text-muted-foreground">
        Turnover = sorties / effectif moyen sur 12 mois glissants. S&apos;enrichit à mesure des embauches/départs enregistrés.
      </p>
    </div>
  );
}

function Kpi({ icon, label, value, tone = "text-foreground" }: { icon: React.ReactNode; label: string; value: string; tone?: string }) {
  return (
    <div className="rounded-2xl border border-border bg-card p-4">
      <span className="inline-flex items-center gap-1.5 text-[12px] text-muted-foreground">{icon} {label}</span>
      <div className={`mt-1 text-[24px] font-bold tnum ${tone}`}>{value}</div>
    </div>
  );
}
