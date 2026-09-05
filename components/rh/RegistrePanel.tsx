"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Loader2, Users, UserCheck, CalendarClock, AlertTriangle, Circle, UserPlus, FileSignature } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ContractDialog } from "@/components/rh/ContractsPanel";

type Member = {
  id: string; name: string; email: string; poste: string | null; service: string | null; sap: string | null;
  statutEmploi: string; hireDate: string | null;
  contractType: string | null; heuresHebdo: number | null; contractStatut: string | null;
  dateDebut: string | null; dateFin: string | null; essaiFin: string | null; saisonLabel: string | null;
  inside: boolean; hasClocked: boolean; workedMin: number;
};
type Alert = { name: string; kind: string; date: string | null; contractType: string };
type State = { stats: { effectif: number; presents: number; congesEnAttente: number; alertes: number }; team: Member[]; alerts: Alert[]; types: string[] };

const fmtHM = (m: number) => `${Math.floor(Math.max(0, m) / 60)}h${String(Math.round(Math.max(0, m) % 60)).padStart(2, "0")}`;
const fmt = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("fr-FR", { day: "2-digit", month: "short", year: "2-digit" }) : "—");
const daysUntil = (iso: string | null): number | null => (iso ? Math.ceil((new Date(iso).getTime() - Date.now()) / 86400_000) : null);

/** REGISTRE DES SALARIÉS — liste unique (présence + contrat + config). Remplace
 *  l'ancien duo Cockpit / Contrats. KPI + échéances en tête ; embauche + renouvellement. */
export function RegistrePanel() {
  const [s, setS] = useState<State | null>(null);
  const [loading, setLoading] = useState(true);
  const [dialog, setDialog] = useState<null | { mode: "hire" | "contract"; emp?: Member }>(null);
  const [showSortis, setShowSortis] = useState(false); // sortis masqués par défaut

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/rh/team", { cache: "no-store" });
      const j = await r.json();
      if (r.ok && j.ok) setS(j);
    } finally { setLoading(false); }
  }, []);
  useEffect(() => {
    load();
    const t = setInterval(load, 60_000); // présence en direct
    return () => clearInterval(t);
  }, [load]);

  if (loading) return <div className="flex justify-center py-20"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;
  if (!s) return <p className="text-center text-muted-foreground py-16">Registre indisponible.</p>;

  const sortisCount = s.team.filter((m) => m.statutEmploi === "sorti").length;
  const visibleTeam = showSortis ? s.team : s.team.filter((m) => m.statutEmploi !== "sorti");

  return (
    <div className="space-y-6">
      {/* KPI */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Kpi icon={<Users className="h-4 w-4" />} label="Effectif" value={s.stats.effectif} tone="text-foreground" />
        <Kpi icon={<UserCheck className="h-4 w-4" />} label="Présents (badgés)" value={s.stats.presents} tone="text-emerald-600 dark:text-emerald-400" />
        <Kpi icon={<CalendarClock className="h-4 w-4" />} label="Congés à valider" value={s.stats.congesEnAttente} tone={s.stats.congesEnAttente > 0 ? "text-amber-600 dark:text-amber-400" : "text-foreground"} />
        <Kpi icon={<AlertTriangle className="h-4 w-4" />} label="Alertes contrat" value={s.stats.alertes} tone={s.stats.alertes > 0 ? "text-rose-600 dark:text-rose-400" : "text-foreground"} />
      </div>

      {/* Échéances contrat */}
      {s.alerts.length > 0 && (
        <div className="rounded-xl border border-amber-500/40 bg-amber-500/[0.06] p-4">
          <h3 className="text-[13px] font-semibold text-amber-700 dark:text-amber-300 flex items-center gap-2 mb-2"><AlertTriangle className="h-4 w-4" /> Échéances contrat (30 jours)</h3>
          <ul className="space-y-1.5">
            {s.alerts.map((a, i) => (
              <li key={i} className="flex items-center justify-between gap-3 text-[13px]">
                <span className="font-medium text-foreground truncate">{a.name}</span>
                <span className="text-muted-foreground tnum whitespace-nowrap">{a.kind === "essai" ? "Fin de période d'essai" : `Fin ${a.contractType}`} · <b className="text-foreground">{fmt(a.date)}</b></span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Registre — LISTE UNIQUE (sortis masqués par défaut) */}
      <div>
        <div className="flex items-center justify-between gap-3 mb-3 flex-wrap">
          <h2 className="text-[15px] font-semibold text-foreground">Registre des salariés</h2>
          <div className="flex items-center gap-2">
            {sortisCount > 0 && (
              <button type="button" onClick={() => setShowSortis((v) => !v)}
                className={`h-9 rounded-lg px-3 text-caption font-medium ring-1 transition-colors ${showSortis ? "bg-secondary text-foreground ring-border" : "bg-background text-muted-foreground ring-border hover:bg-secondary"}`}>
                {showSortis ? `Masquer les sortis (${sortisCount})` : `Voir les sortis (${sortisCount})`}
              </button>
            )}
            <Button onClick={() => setDialog({ mode: "hire" })}><UserPlus className="h-4 w-4" /> Embaucher</Button>
          </div>
        </div>
        <div className="rounded-xl border border-border bg-card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead className="bg-secondary/50 text-[11px] uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="text-left px-3 py-2 font-semibold">Salarié</th>
                  <th className="text-left px-3 py-2 font-semibold">Poste / service</th>
                  <th className="text-left px-3 py-2 font-semibold w-40">Contrat</th>
                  <th className="text-left px-3 py-2 font-semibold w-36">Période</th>
                  <th className="text-center px-3 py-2 font-semibold w-32">Aujourd'hui</th>
                  <th className="text-left px-3 py-2 font-semibold w-40">Statut</th>
                  <th className="text-right px-3 py-2 font-semibold w-32" />
                </tr>
              </thead>
              <tbody>
                {visibleTeam.map((m) => {
                  const sorti = m.statutEmploi === "sorti";
                  const essaiIn = daysUntil(m.essaiFin);
                  const cddIn = daysUntil(m.dateFin);
                  return (
                    <tr key={m.id} className="border-t border-border/60 hover:bg-secondary/30">
                      <td className="px-3 py-2.5">
                        <Link href={`/rh/salarie/${m.id}`} className="font-semibold text-foreground hover:text-primary hover:underline underline-offset-2">{m.name}</Link>
                        {m.sap && <span className="ml-1.5 text-[10px] font-mono text-muted-foreground">{m.sap}</span>}
                      </td>
                      <td className="px-3 py-2.5 text-muted-foreground">{[m.poste, m.service].filter(Boolean).join(" · ") || "—"}</td>
                      <td className="px-3 py-2.5">
                        {m.contractType ? <span className="font-medium text-foreground">{m.contractType}</span> : <span className="text-muted-foreground">—</span>}
                        {m.heuresHebdo != null && <span className="block text-[11px] text-muted-foreground tnum">{m.heuresHebdo}h/sem</span>}
                        {m.saisonLabel && <span className="block text-[11px] text-amber-600 dark:text-amber-400">{m.saisonLabel}</span>}
                      </td>
                      <td className="px-3 py-2.5 tnum text-muted-foreground">{m.dateDebut ? <>{fmt(m.dateDebut)}{m.dateFin ? ` → ${fmt(m.dateFin)}` : ""}</> : "—"}</td>
                      <td className="px-3 py-2.5 text-center">
                        {sorti ? <span className="text-[12px] text-muted-foreground/50">—</span>
                          : m.inside ? <span className="inline-flex items-center gap-1 text-[12px] font-semibold text-emerald-600 dark:text-emerald-400"><Circle className="h-2 w-2 fill-current" /> {fmtHM(m.workedMin)}</span>
                          : m.hasClocked ? <span className="text-[12px] text-muted-foreground">Parti · {fmtHM(m.workedMin)}</span>
                          : <span className="text-[12px] text-muted-foreground/50">—</span>}
                      </td>
                      <td className="px-3 py-2.5">
                        {sorti ? <Badge tone="zinc">Sorti</Badge>
                          : essaiIn != null && essaiIn >= 0 && essaiIn <= 30 ? <Badge tone="amber"><AlertTriangle className="h-3 w-3" /> Essai dans {essaiIn}j</Badge>
                          : cddIn != null && cddIn >= 0 && cddIn <= 30 ? <Badge tone="rose"><AlertTriangle className="h-3 w-3" /> Fin {m.contractType} dans {cddIn}j</Badge>
                          : m.contractType ? <Badge tone="emerald">Actif</Badge>
                          : <Badge tone="zinc">Sans contrat</Badge>}
                      </td>
                      <td className="px-3 py-2.5 text-right">
                        <Button variant="outline" size="sm" onClick={() => setDialog({ mode: "contract", emp: m })}>
                          <FileSignature className="h-3.5 w-3.5" /> {m.contractType ? "Renouveler" : "Contrat"}
                        </Button>
                      </td>
                    </tr>
                  );
                })}
                {visibleTeam.length === 0 && <tr><td colSpan={7} className="px-3 py-8 text-center text-muted-foreground">{s.team.length === 0 ? "Aucun salarié." : "Aucun salarié actif — voir les sortis."}</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
        <p className="mt-2 text-center text-[12px] text-muted-foreground">Présence en temps réel (badgeuse). Cliquez un salarié pour sa fiche complète (contrats, horaires, documents, congés).</p>
      </div>

      {dialog && (
        <ContractDialog
          mode={dialog.mode}
          emp={dialog.emp ? { id: dialog.emp.id, email: dialog.emp.email, displayName: dialog.emp.name } : undefined}
          types={s.types}
          onClose={() => setDialog(null)}
          onSaved={() => { setDialog(null); load(); }}
        />
      )}
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
function Badge({ tone, children }: { tone: "emerald" | "amber" | "rose" | "zinc"; children: React.ReactNode }) {
  const cls = { emerald: "bg-emerald-500/12 text-emerald-700 dark:text-emerald-300", amber: "bg-amber-500/15 text-amber-700 dark:text-amber-300", rose: "bg-rose-500/15 text-rose-700 dark:text-rose-300", zinc: "bg-secondary text-muted-foreground" }[tone];
  return <span className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11.5px] font-semibold ${cls}`}>{children}</span>;
}
