"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Loader2, ChevronLeft, ChevronRight, CalendarRange } from "lucide-react";
import { fmtHM } from "@/lib/rh/time";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

type Day = { plannedMin: number; actualMin: number; min: number; tag: string | null };
type Row = { employeeId: string; name: string; poste: string | null; days: Day[] };
type Week = { isoWeek: string; days: string[]; holidays: string[]; badgeuse: boolean; rows: Row[] };

const DOW = ["Lun", "Mar", "Mer", "Jeu", "Ven", "Sam", "Dim"];
const CELL: Record<string, { cls: string; label: string }> = {
  present: { cls: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300", label: "Présent" },
  conges: { cls: "bg-amber-500/15 text-amber-700 dark:text-amber-300", label: "Congé" },
  recup: { cls: "bg-sky-500/15 text-sky-700 dark:text-sky-300", label: "Récup" },
  maladie: { cls: "bg-rose-500/15 text-rose-700 dark:text-rose-300", label: "Maladie" },
  ferie: { cls: "bg-violet-500/15 text-violet-700 dark:text-violet-300", label: "Férié" },
  absent: { cls: "bg-transparent text-muted-foreground", label: "—" },
};

/** Planning (RH V2) — vue calendrier hebdo qui-travaille-quand (présence badgée,
 *  congés approuvés, fériés). Remplace l'ancien onglet Planning. */
export function PlanningTeamPanel({ initialWeek }: { initialWeek: string }) {
  const [iso, setIso] = useState(initialWeek);
  const [data, setData] = useState<Week | null>(null);
  const [loading, setLoading] = useState(true);
  const [edit, setEdit] = useState<{ employeeId: string; name: string; dayIndex: number; date: string } | null>(null);

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
    const m = /^(\d{4})-W(\d{2})$/.exec(iso); if (!m) return;
    const jan4 = new Date(Date.UTC(Number(m[1]), 0, 4));
    const dow = (jan4.getUTCDay() + 6) % 7;
    const mon = new Date(jan4); mon.setUTCDate(jan4.getUTCDate() - dow + (Number(m[2]) - 1) * 7 + n * 7);
    const thu = new Date(mon); thu.setUTCDate(mon.getUTCDate() + 3);
    const ys = new Date(Date.UTC(thu.getUTCFullYear(), 0, 1));
    const wk = Math.ceil(((thu.getTime() - ys.getTime()) / 86400000 + 1) / 7);
    setIso(`${thu.getUTCFullYear()}-W${String(wk).padStart(2, "0")}`);
  };

  const range = data ? `${fmtDate(data.days[0])} → ${fmtDate(data.days[6])}` : "";

  return (
    <div className="space-y-4">
      {data && !data.badgeuse && (
        <div className="rounded-xl border border-sky-500/40 bg-sky-500/[0.06] px-4 py-2.5 text-[13px] text-foreground">
          <b>Badgeuse désactivée</b> — <span className="text-muted-foreground">présence = horaires prévus au contrat. « Pointé » reflète l&apos;horaire prévu (les absences approuvées restent déduites).</span>
        </div>
      )}
      <div className="flex items-center gap-1.5">
        <button type="button" onClick={() => shift(-1)} className="h-9 w-9 rounded-lg border border-border flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-secondary"><ChevronLeft className="h-4 w-4" /></button>
        <span className="inline-flex items-center gap-2 rounded-lg border border-border bg-card px-3 h-9 text-[13px] font-semibold text-foreground"><CalendarRange className="h-4 w-4 text-muted-foreground" /> {iso} · {range}</span>
        <button type="button" onClick={() => shift(1)} className="h-9 w-9 rounded-lg border border-border flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-secondary"><ChevronRight className="h-4 w-4" /></button>
      </div>

      {loading ? (
        <div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
      ) : !data || data.rows.length === 0 ? (
        <p className="text-center text-muted-foreground py-12">Aucun salarié actif.</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border">
          <table className="w-full text-[13px]">
            <thead className="bg-secondary/50 text-muted-foreground">
              <tr>
                <th className="text-left font-medium px-3 py-2 sticky left-0 bg-secondary/50">Salarié</th>
                {DOW.map((d, i) => (
                  <th key={d} className={`text-center font-medium px-2 py-2 ${data.holidays.includes(data.days[i]) ? "text-violet-500" : ""}`}>
                    {d}<span className="block text-[10px] font-normal">{fmtDay(data.days[i])}</span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {data.rows.map((r) => (
                <tr key={r.employeeId}>
                  <td className="px-3 py-1.5 sticky left-0 bg-card"><span className="font-medium text-foreground whitespace-nowrap">{r.name}</span></td>
                  {r.days.map((d, i) => {
                    const c = CELL[d.tag ?? "absent"] ?? CELL.absent;
                    const showPlanned = d.tag === "present" && d.plannedMin > 0 && d.plannedMin !== d.actualMin;
                    return (
                      <td key={i} className="px-1.5 py-1.5 text-center align-top">
                        <button type="button" onClick={() => setEdit({ employeeId: r.employeeId, name: r.name, dayIndex: i, date: data.days[i] })}
                          className={`inline-block min-w-[52px] rounded-md px-2 py-1 text-[11.5px] font-medium hover:ring-1 hover:ring-brand-500/50 transition ${c.cls}`} title={showPlanned ? `Prévu ${fmtHM(d.plannedMin)} · pointé ${fmtHM(d.actualMin)} — cliquer pour modifier` : "Cliquer pour modifier"}>
                          {d.tag === "present" ? fmtHM(d.actualMin || d.min) : c.label === "—" ? "—" : c.label}
                        </button>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Légende */}
      <div className="flex flex-wrap items-center gap-3 text-[11px] text-muted-foreground">
        {Object.entries(CELL).filter(([k]) => k !== "absent").map(([k, c]) => (
          <span key={k} className="inline-flex items-center gap-1.5"><span className={`h-3 w-3 rounded ${c.cls}`} /> {c.label}</span>
        ))}
        <span className="ml-auto">Cliquez une case pour modifier le planning.</span>
      </div>

      {edit && <DayEditor edit={edit} iso={iso} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); load(iso); }} />}
    </div>
  );
}

/** Édition manuelle d'un jour de planning (direction) → RhWeekSheet.days. */
function DayEditor({ edit, iso, onClose, onSaved }: { edit: { employeeId: string; name: string; dayIndex: number; date: string }; iso: string; onClose: () => void; onSaved: () => void }) {
  const [mode, setMode] = useState<"present" | "conges" | "recup" | "maladie" | "absent">("present");
  const [hours, setHours] = useState("7:00");
  const [saving, setSaving] = useState(false);

  const post = async (body: Record<string, unknown>) => {
    setSaving(true);
    try {
      const r = await fetch("/api/rh/planning/day", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ employeeId: edit.employeeId, isoWeek: iso, dayIndex: edit.dayIndex, ...body }) });
      const j = await r.json();
      if (!r.ok || !j.ok) { toast.error(j.error || "Échec"); return; }
      toast.success("Planning mis à jour"); onSaved();
    } finally { setSaving(false); }
  };
  const save = () => {
    if (mode === "present") {
      const m = /^(\d{1,2})[:hH.,]?(\d{0,2})$/.exec(hours.trim());
      const min = m ? Number(m[1]) * 60 + (m[2] ? Number(m[2]) : 0) : NaN;
      if (!Number.isFinite(min) || min < 0) { toast.error("Heures invalides (ex. 7:00)"); return; }
      post({ tag: "present", min });
    } else post({ tag: mode });
  };

  const d = new Date(edit.date + "T00:00:00Z").toLocaleDateString("fr-FR", { weekday: "long", day: "2-digit", month: "long", timeZone: "UTC" });
  const MODES: { v: typeof mode; label: string }[] = [
    { v: "present", label: "Présent" }, { v: "conges", label: "Congé" }, { v: "recup", label: "Récup" }, { v: "maladie", label: "Maladie" }, { v: "absent", label: "Absent" },
  ];
  return (
    <Dialog open onOpenChange={(o) => { if (!o && !saving) onClose(); }}>
      <DialogContent size="sm">
        <DialogHeader className="text-left"><DialogTitle>{edit.name}</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <p className="text-[13px] text-muted-foreground capitalize">{d}</p>
          <div className="flex flex-wrap gap-1.5">
            {MODES.map((m) => (
              <button key={m.v} type="button" onClick={() => setMode(m.v)}
                className={`h-8 rounded-lg px-3 text-caption font-medium ring-1 ${mode === m.v ? "bg-brand-500 text-black ring-brand-500" : "bg-background text-foreground ring-border hover:bg-secondary"}`}>{m.label}</button>
            ))}
          </div>
          {mode === "present" && (
            <label className="block"><span className="text-caption font-medium">Heures travaillées</span>
              <Input value={hours} onChange={(e) => setHours(e.target.value)} placeholder="7:00" className="mt-1 w-32" />
            </label>
          )}
          <div className="flex items-center gap-2 pt-1">
            <Button variant="outline" size="xl" onClick={() => post({ clear: true })} disabled={saving} title="Revenir au calcul automatique">Auto</Button>
            <Button variant="outline" size="xl" onClick={onClose} disabled={saving} className="flex-1">Annuler</Button>
            <Button size="xl" onClick={save} disabled={saving} className="flex-1">{saving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Enregistrer"}</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function fmtDate(iso: string): string {
  return new Date(iso + "T00:00:00Z").toLocaleDateString("fr-FR", { day: "2-digit", month: "short", timeZone: "UTC" });
}
function fmtDay(iso: string): string {
  return new Date(iso + "T00:00:00Z").toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit", timeZone: "UTC" });
}
