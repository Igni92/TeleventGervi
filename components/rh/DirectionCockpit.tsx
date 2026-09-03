"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Loader2, Users, UserCheck, CalendarClock, AlertTriangle, Circle } from "lucide-react";

type TeamMember = {
  id: string; name: string; poste: string | null; service: string | null; sap: string | null;
  contractType: string | null; heuresHebdo: number | null; hireDate: string | null;
  inside: boolean; hasClocked: boolean; workedMin: number;
};
type Alert = { name: string; kind: string; date: string | null; contractType: string };
type TeamState = {
  stats: { effectif: number; presents: number; congesEnAttente: number; alertes: number };
  team: TeamMember[];
  alerts: Alert[];
};

const fmtHM = (m: number) => `${Math.floor(Math.max(0, m) / 60)}h${String(Math.round(Math.max(0, m) % 60)).padStart(2, "0")}`;
const fmtDate = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("fr-FR", { day: "2-digit", month: "short" }) : "—");

/** Cockpit RH direction — présence du jour (badgeuse), effectif, alertes contrat,
 *  congés à valider. Desktop. */
export function DirectionCockpit() {
  const [s, setS] = useState<TeamState | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let live = true;
    const load = async () => {
      try {
        const r = await fetch("/api/rh/team", { cache: "no-store" });
        const j = await r.json();
        if (live && r.ok && j.ok) setS(j);
      } finally { if (live) setLoading(false); }
    };
    load();
    const t = setInterval(load, 60_000); // présence en direct
    return () => { live = false; clearInterval(t); };
  }, []);

  if (loading) return <div className="flex justify-center py-20"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;
  if (!s) return <p className="text-center text-muted-foreground py-16">Cockpit indisponible.</p>;

  return (
    <div className="space-y-6">
      {/* KPI */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Kpi icon={<Users className="h-4 w-4" />} label="Effectif" value={s.stats.effectif} tone="text-foreground" />
        <Kpi icon={<UserCheck className="h-4 w-4" />} label="Présents (badgés)" value={s.stats.presents} tone="text-emerald-600 dark:text-emerald-400" />
        <Kpi icon={<CalendarClock className="h-4 w-4" />} label="Congés à valider" value={s.stats.congesEnAttente} tone={s.stats.congesEnAttente > 0 ? "text-amber-600 dark:text-amber-400" : "text-foreground"} />
        <Kpi icon={<AlertTriangle className="h-4 w-4" />} label="Alertes contrat" value={s.stats.alertes} tone={s.stats.alertes > 0 ? "text-rose-600 dark:text-rose-400" : "text-foreground"} />
      </div>

      {/* Alertes fin d'essai / CDD */}
      {s.alerts.length > 0 && (
        <div className="rounded-xl border border-amber-500/40 bg-amber-500/[0.06] p-4">
          <h3 className="text-[13px] font-semibold text-amber-700 dark:text-amber-300 flex items-center gap-2 mb-2">
            <AlertTriangle className="h-4 w-4" /> Échéances contrat (30 jours)
          </h3>
          <ul className="space-y-1.5">
            {s.alerts.map((a, i) => (
              <li key={i} className="flex items-center justify-between gap-3 text-[13px]">
                <span className="font-medium text-foreground truncate">{a.name}</span>
                <span className="text-muted-foreground tnum whitespace-nowrap">
                  {a.kind === "essai" ? "Fin de période d'essai" : `Fin ${a.contractType}`} · <b className="text-foreground">{fmtDate(a.date)}</b>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Équipe */}
      <div className="rounded-xl border border-border bg-card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-[13px]">
            <thead className="bg-secondary/50 text-[11px] uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="text-left px-3 py-2 font-semibold">Salarié</th>
                <th className="text-left px-3 py-2 font-semibold">Poste / service</th>
                <th className="text-left px-3 py-2 font-semibold w-28">Contrat</th>
                <th className="text-center px-3 py-2 font-semibold w-28">Aujourd'hui</th>
                <th className="text-right px-3 py-2 font-semibold w-24">Heures</th>
              </tr>
            </thead>
            <tbody>
              {s.team.map((m) => (
                <tr key={m.id} className="border-t border-border/60 hover:bg-secondary/30">
                  <td className="px-3 py-2.5">
                    <span className="font-semibold text-foreground">{m.name}</span>
                    {m.sap && <span className="ml-1.5 text-[10px] font-mono text-muted-foreground">{m.sap}</span>}
                  </td>
                  <td className="px-3 py-2.5 text-muted-foreground">{[m.poste, m.service].filter(Boolean).join(" · ") || "—"}</td>
                  <td className="px-3 py-2.5 text-muted-foreground">{m.contractType ?? "—"}{m.heuresHebdo ? ` · ${m.heuresHebdo}h` : ""}</td>
                  <td className="px-3 py-2.5 text-center">
                    {m.inside ? (
                      <span className="inline-flex items-center gap-1 text-[12px] font-semibold text-emerald-600 dark:text-emerald-400"><Circle className="h-2 w-2 fill-current" /> Présent</span>
                    ) : m.hasClocked ? (
                      <span className="text-[12px] text-muted-foreground">Parti</span>
                    ) : (
                      <span className="text-[12px] text-muted-foreground/50">—</span>
                    )}
                  </td>
                  <td className="px-3 py-2.5 text-right tnum font-semibold text-foreground">{m.hasClocked ? fmtHM(m.workedMin) : "—"}</td>
                </tr>
              ))}
              {s.team.length === 0 && (
                <tr><td colSpan={5} className="px-3 py-8 text-center text-muted-foreground">Aucun salarié.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <p className="text-center text-[12px] text-muted-foreground">
        Présence en temps réel depuis la badgeuse · <Link href="/rh" className="underline underline-offset-2">mon espace</Link>
      </p>
    </div>
  );
}

function Kpi({ icon, label, value, tone }: { icon: React.ReactNode; label: string; value: number; tone: string }) {
  return (
    <div className="rounded-2xl border border-border bg-card p-4">
      <span className="inline-flex items-center gap-1.5 text-[12px] text-muted-foreground">{icon} {label}</span>
      <div className={`mt-1 text-[26px] font-bold tnum ${tone}`}>{value}</div>
    </div>
  );
}
