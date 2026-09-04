"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2, ChevronLeft, ChevronRight, CalendarRange } from "lucide-react";
import { fmtHM } from "@/lib/rh/time";

type Day = { plannedMin: number; actualMin: number; min: number; tag: string | null };
type Row = { employeeId: string; name: string; poste: string | null; contractHours: number; days: Day[]; calc: WeekCalc; validationStatus: string };
type WeekCalc = { totalMin: number; contractMin: number; deltaMin: number; sup25Min: number; sup50Min: number; recupMin: number; majEquivMin: number };
type Week = { isoWeek: string; days: string[]; holidays: string[]; badgeuse: boolean; rows: Row[] };

const DOW = ["Lun", "Mar", "Mer", "Jeu", "Ven", "Sam", "Dim"];
const TAG_CLS: Record<string, string> = {
  present: "text-foreground",
  conges: "text-amber-600 dark:text-amber-400",
  recup: "text-sky-600 dark:text-sky-400",
  maladie: "text-rose-600 dark:text-rose-400",
  ferie: "text-violet-600 dark:text-violet-400",
  absent: "text-muted-foreground",
};
const VALID_LABEL: Record<string, { label: string; cls: string }> = {
  draft: { label: "Brouillon", cls: "bg-secondary text-muted-foreground" },
  sent: { label: "Envoyé", cls: "bg-amber-500/12 text-amber-700 dark:text-amber-300" },
  counter: { label: "Contre-prop.", cls: "bg-sky-500/12 text-sky-700 dark:text-sky-300" },
  agreed: { label: "Validé", cls: "bg-emerald-500/12 text-emerald-700 dark:text-emerald-300" },
};

/** Heures & pointages (RH V2) — feuille d'équipe par semaine, calculée par le moteur
 *  neuf (badgeuse + congés + fériés). Remplace l'ancien onglet Effectif/Heures. */
export function HeuresTeamPanel({ initialWeek }: { initialWeek: string }) {
  const [iso, setIso] = useState(initialWeek);
  const [data, setData] = useState<Week | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async (w: string) => {
    setLoading(true);
    try {
      const r = await fetch(`/api/rh/week?week=${w}`, { cache: "no-store" });
      const j = await r.json();
      if (r.ok && j.ok) setData(j);
    } finally { setLoading(false); }
  }, []);
  useEffect(() => { load(iso); }, [iso, load]);

  const shift = (n: number) => {
    // décalage via l'API du serveur : on recompose une date puis relit — ici simple
    // décalage ISO côté client par recalcul du lundi.
    const m = /^(\d{4})-W(\d{2})$/.exec(iso); if (!m) return;
    const jan4 = new Date(Date.UTC(Number(m[1]), 0, 4));
    const dow = (jan4.getUTCDay() + 6) % 7;
    const mon = new Date(jan4); mon.setUTCDate(jan4.getUTCDate() - dow + (Number(m[2]) - 1) * 7 + n * 7);
    const thu = new Date(mon); thu.setUTCDate(mon.getUTCDate() + 3);
    const ys = new Date(Date.UTC(thu.getUTCFullYear(), 0, 1));
    const wk = Math.ceil(((thu.getTime() - ys.getTime()) / 86400000 + 1) / 7);
    setIso(`${thu.getUTCFullYear()}-W${String(wk).padStart(2, "0")}`);
  };

  const totals = useMemo(() => {
    const rows = data?.rows ?? [];
    return {
      worked: rows.reduce((s, r) => s + r.calc.totalMin, 0),
      sup: rows.reduce((s, r) => s + r.calc.sup25Min + r.calc.sup50Min, 0),
      recup: rows.reduce((s, r) => s + r.calc.recupMin, 0),
    };
  }, [data]);

  const range = data ? `${fmtDate(data.days[0])} → ${fmtDate(data.days[6])}` : "";

  const toggleBadgeuse = async () => {
    if (!data) return;
    const next = !data.badgeuse;
    if (!confirm(next ? "Réactiver la badgeuse ? Les salariés pointeront à nouveau leurs heures." : "Désactiver la badgeuse ? Les salariés seront réputés présents aux horaires de leur contrat.")) return;
    const r = await fetch("/api/rh/settings", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ badgeuseEnabled: next }) });
    if (!r.ok) return;
    load(iso);
  };

  return (
    <div className="space-y-4">
      {/* Réglage badgeuse */}
      {data && (
        <div className={`flex items-center justify-between gap-3 rounded-xl border px-4 py-2.5 ${data.badgeuse ? "border-border bg-card" : "border-sky-500/40 bg-sky-500/[0.06]"}`}>
          <span className="text-[13px] text-foreground">
            <b>Badgeuse</b> {data.badgeuse ? "activée" : "désactivée"} —{" "}
            <span className="text-muted-foreground">{data.badgeuse ? "heures issues des pointages." : "présence = horaires du contrat (les absences restent déduites)."}</span>
          </span>
          <button type="button" onClick={toggleBadgeuse}
            className={`shrink-0 h-8 rounded-lg px-3 text-caption font-medium ring-1 transition-colors ${data.badgeuse ? "bg-background text-foreground ring-border hover:bg-secondary" : "bg-sky-500 text-white ring-sky-500"}`}>
            {data.badgeuse ? "Désactiver" : "Réactiver"}
          </button>
        </div>
      )}
      {/* Navigateur de semaine */}
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-1.5">
          <button type="button" onClick={() => shift(-1)} className="h-9 w-9 rounded-lg border border-border flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-secondary"><ChevronLeft className="h-4 w-4" /></button>
          <span className="inline-flex items-center gap-2 rounded-lg border border-border bg-card px-3 h-9 text-[13px] font-semibold text-foreground"><CalendarRange className="h-4 w-4 text-muted-foreground" /> {iso} · {range}</span>
          <button type="button" onClick={() => shift(1)} className="h-9 w-9 rounded-lg border border-border flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-secondary"><ChevronRight className="h-4 w-4" /></button>
        </div>
        <div className="flex items-center gap-3 text-[12px]">
          <Kpi label="Travaillé" value={fmtHM(totals.worked)} />
          <Kpi label="Heures supp" value={fmtHM(totals.sup)} tone="text-amber-600 dark:text-amber-400" />
          <Kpi label="Récup" value={fmtHM(totals.recup)} tone="text-sky-600 dark:text-sky-400" />
        </div>
      </div>

      {loading ? (
        <div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
      ) : !data || data.rows.length === 0 ? (
        <p className="text-center text-muted-foreground py-12">Aucun salarié actif.</p>
      ) : (
        <>
          {/* Desktop : tableau */}
          <div className="hidden md:block overflow-x-auto rounded-xl border border-border">
            <table className="w-full text-[13px]">
              <thead className="bg-secondary/50 text-muted-foreground">
                <tr>
                  <th className="text-left font-medium px-3 py-2">Salarié</th>
                  {DOW.map((d, i) => <th key={d} className={`text-center font-medium px-2 py-2 ${data.holidays.includes(data.days[i]) ? "text-violet-500" : ""}`}>{d}</th>)}
                  <th className="text-right font-medium px-3 py-2">Total</th>
                  <th className="text-right font-medium px-3 py-2">Δ contrat</th>
                  <th className="text-right font-medium px-3 py-2">Supp</th>
                  <th className="text-center font-medium px-3 py-2">Statut</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {data.rows.map((r) => {
                  const v = VALID_LABEL[r.validationStatus] ?? VALID_LABEL.draft;
                  return (
                    <tr key={r.employeeId} className="hover:bg-secondary/30">
                      <td className="px-3 py-2"><span className="font-medium text-foreground">{r.name}</span><span className="block text-[11px] text-muted-foreground">{r.contractHours}h/sem</span></td>
                      {r.days.map((d, i) => (
                        <td key={i} className={`text-center px-2 py-2 tnum ${TAG_CLS[d.tag ?? "absent"]}`} title={d.tag ?? ""}>
                          {d.min > 0 ? fmtHM(d.min) : d.tag === "conges" ? "CP" : d.tag === "recup" ? "R" : d.tag === "maladie" ? "M" : d.tag === "ferie" ? "F" : "—"}
                        </td>
                      ))}
                      <td className="text-right px-3 py-2 font-semibold tnum text-foreground">{fmtHM(r.calc.totalMin)}</td>
                      <td className={`text-right px-3 py-2 tnum ${r.calc.deltaMin < 0 ? "text-sky-600 dark:text-sky-400" : r.calc.deltaMin > 0 ? "text-amber-600 dark:text-amber-400" : "text-muted-foreground"}`}>{r.calc.deltaMin === 0 ? "—" : fmtHM(r.calc.deltaMin)}</td>
                      <td className="text-right px-3 py-2 tnum text-amber-600 dark:text-amber-400">{(r.calc.sup25Min + r.calc.sup50Min) > 0 ? fmtHM(r.calc.sup25Min + r.calc.sup50Min) : "—"}</td>
                      <td className="text-center px-3 py-2"><span className={`rounded px-1.5 py-0.5 text-[11px] font-medium ${v.cls}`}>{v.label}</span></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Mobile : cartes */}
          <div className="md:hidden space-y-2">
            {data.rows.map((r) => {
              const v = VALID_LABEL[r.validationStatus] ?? VALID_LABEL.draft;
              return (
                <div key={r.employeeId} className="rounded-xl border border-border bg-card p-3">
                  <div className="flex items-center justify-between">
                    <span className="font-medium text-foreground">{r.name}</span>
                    <span className={`rounded px-1.5 py-0.5 text-[11px] font-medium ${v.cls}`}>{v.label}</span>
                  </div>
                  <div className="mt-1 flex items-center gap-3 text-[13px]">
                    <span className="font-semibold text-foreground">{fmtHM(r.calc.totalMin)}</span>
                    <span className="text-muted-foreground">/ {r.contractHours}h</span>
                    {(r.calc.sup25Min + r.calc.sup50Min) > 0 && <span className="text-amber-600 dark:text-amber-400">+{fmtHM(r.calc.sup25Min + r.calc.sup50Min)} supp</span>}
                    {r.calc.recupMin > 0 && <span className="text-sky-600 dark:text-sky-400">{fmtHM(r.calc.recupMin)} récup</span>}
                  </div>
                </div>
              );
            })}
          </div>
          <p className="text-center text-[11px] text-muted-foreground">Calcul par le moteur RH neuf (badgeuse + congés + fériés) — majorations +25 %/+50 % (IDCC 1405). CP=congé · R=récup · M=maladie · F=férié.</p>
        </>
      )}
    </div>
  );
}

function Kpi({ label, value, tone = "text-foreground" }: { label: string; value: string; tone?: string }) {
  return <span className="inline-flex flex-col items-end"><span className="text-[10px] text-muted-foreground uppercase tracking-wide">{label}</span><span className={`font-bold tnum ${tone}`}>{value}</span></span>;
}
function fmtDate(iso: string): string {
  const d = new Date(iso + "T00:00:00Z");
  return d.toLocaleDateString("fr-FR", { day: "2-digit", month: "short", timeZone: "UTC" });
}
