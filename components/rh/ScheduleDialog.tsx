"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Loader2, Plus, Trash2, Clock, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { parseSchedule, defaultSchedule, netDayMinutes, type WeekSchedule, type DaySpec } from "@/lib/rh/schedule";
import { fmtHM } from "@/lib/rh/time";

const DOW = [
  { iso: "1", label: "Lun" }, { iso: "2", label: "Mar" }, { iso: "3", label: "Mer" },
  { iso: "4", label: "Jeu" }, { iso: "5", label: "Ven" }, { iso: "6", label: "Sam" }, { iso: "7", label: "Dim" },
];

/** Éditeur des HORAIRES PRÉVUS + MODULATION saisonnière d'un contrat. Plusieurs
 *  périodes dans l'année (ex. 6 mois hautes horaires / 6 mois basses), chacune ses
 *  horaires par jour. La pause légale (≥6h → 20 min) est appliquée au calcul net. */
export function ScheduleDialog({ contract, onClose, onSaved }: {
  contract: { id: string; heuresHebdo: number; horairesJson?: string | null };
  onClose: () => void; onSaved: () => void;
}) {
  const [sched, setSched] = useState<WeekSchedule>(() => parseSchedule(contract.horairesJson ?? null, contract.heuresHebdo));
  const [saving, setSaving] = useState(false);

  const update = (fn: (s: WeekSchedule) => WeekSchedule) => setSched((s) => fn(structuredClone(s)));
  const addPeriod = () => update((s) => { s.periods.push({ label: "Nouvelle période", from: "01-01", to: "12-31", days: {} }); return s; });
  const removePeriod = (pi: number) => update((s) => { s.periods.splice(pi, 1); if (s.periods.length === 0) s.periods.push({ label: "Toute l'année", from: "01-01", to: "12-31", days: {} }); return s; });
  const setField = (pi: number, k: "label" | "from" | "to", v: string) => update((s) => { const p = s.periods[pi]; if (k === "label") p.label = v; else if (k === "from") p.from = v; else p.to = v; return s; });
  const toggleDay = (pi: number, iso: string, on: boolean) => update((s) => {
    if (on) s.periods[pi].days[iso] = s.periods[pi].days[iso] ?? { start: "08:00", end: "16:00", pauseMin: 60 };
    else delete s.periods[pi].days[iso];
    return s;
  });
  const setDay = (pi: number, iso: string, k: keyof DaySpec, v: string) => update((s) => {
    const d = s.periods[pi].days[iso]; if (!d) return s;
    if (k === "pauseMin") d.pauseMin = Math.max(0, Number(v) || 0);
    else if (k === "start") d.start = v; else if (k === "end") d.end = v;
    return s;
  });

  const save = async () => {
    setSaving(true);
    try {
      const r = await fetch(`/api/rh/contracts/${contract.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ horairesJson: JSON.stringify(sched) }) });
      const j = await r.json();
      if (!r.ok || !j.ok) { toast.error(j.error || "Échec"); return; }
      toast.success("Horaires enregistrés"); onSaved();
    } finally { setSaving(false); }
  };
  const resetDefault = async () => {
    if (!confirm("Réinitialiser aux horaires par défaut (dérivés des heures hebdo) ?")) return;
    setSaving(true);
    try {
      await fetch(`/api/rh/contracts/${contract.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ horairesJson: null }) });
      toast.success("Horaires réinitialisés"); onSaved();
    } finally { setSaving(false); }
  };

  const weekNet = (pi: number) => DOW.reduce((s, d) => { const spec = sched.periods[pi].days[d.iso]; return s + (spec ? netDayMinutes(spec) : 0); }, 0);

  return (
    <Dialog open onOpenChange={(o) => { if (!o && !saving) onClose(); }}>
      <DialogContent size="lg">
        <DialogHeader className="text-left"><DialogTitle className="flex items-center gap-2"><Clock className="h-5 w-5" /> Horaires & modulation</DialogTitle></DialogHeader>
        <div className="space-y-4 max-h-[70vh] overflow-y-auto pr-1">
          <p className="text-[12px] text-muted-foreground">Définissez les horaires par jour. Plusieurs périodes = modulation saisonnière (ex. 6 mois hautes horaires, 6 mois basses). Pause légale (20 min dès 6 h) appliquée automatiquement au net.</p>
          {sched.periods.map((p, pi) => (
            <div key={pi} className="rounded-xl border border-border bg-card p-3 space-y-3">
              <div className="flex items-center gap-2 flex-wrap">
                <Input value={p.label ?? ""} onChange={(e) => setField(pi, "label", e.target.value)} placeholder="Libellé période" className="h-8 flex-1 min-w-[140px]" />
                <span className="text-caption text-muted-foreground">du</span>
                <Input value={p.from} onChange={(e) => setField(pi, "from", e.target.value)} placeholder="MM-JJ" className="h-8 w-24" />
                <span className="text-caption text-muted-foreground">au</span>
                <Input value={p.to} onChange={(e) => setField(pi, "to", e.target.value)} placeholder="MM-JJ" className="h-8 w-24" />
                <span className="text-caption font-medium text-foreground ml-auto">{fmtHM(weekNet(pi))}/sem</span>
                {sched.periods.length > 1 && <button type="button" onClick={() => removePeriod(pi)} className="text-muted-foreground hover:text-destructive"><Trash2 className="h-4 w-4" /></button>}
              </div>
              <div className="space-y-1">
                {DOW.map((d) => {
                  const spec = p.days[d.iso];
                  return (
                    <div key={d.iso} className="flex items-center gap-2 text-[13px]">
                      <label className="flex items-center gap-1.5 w-16 shrink-0">
                        <input type="checkbox" checked={!!spec} onChange={(e) => toggleDay(pi, d.iso, e.target.checked)} className="accent-brand-500" /> {d.label}
                      </label>
                      {spec ? (
                        <>
                          <Input type="time" value={spec.start} onChange={(e) => setDay(pi, d.iso, "start", e.target.value)} className="h-8 w-28" />
                          <span className="text-muted-foreground">→</span>
                          <Input type="time" value={spec.end} onChange={(e) => setDay(pi, d.iso, "end", e.target.value)} className="h-8 w-28" />
                          <span className="text-caption text-muted-foreground">pause</span>
                          <Input type="number" value={spec.pauseMin ?? 0} onChange={(e) => setDay(pi, d.iso, "pauseMin", e.target.value)} className="h-8 w-16" title="minutes de pause" />
                          <span className="text-caption text-muted-foreground ml-auto tnum">{fmtHM(netDayMinutes(spec))} net</span>
                        </>
                      ) : <span className="text-[12px] text-muted-foreground">repos</span>}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
          <Button size="sm" variant="outline" onClick={addPeriod}><Plus className="h-3.5 w-3.5" /> Ajouter une période (modulation)</Button>
        </div>
        <div className="flex items-center gap-2 pt-2 border-t border-border">
          <Button variant="outline" size="xl" onClick={resetDefault} disabled={saving} title="Réinitialiser au défaut"><RotateCcw className="h-4 w-4" /></Button>
          <Button variant="outline" size="xl" onClick={onClose} disabled={saving} className="flex-1">Annuler</Button>
          <Button size="xl" onClick={save} disabled={saving} className="flex-1">{saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Clock className="h-4 w-4" />} Enregistrer</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
