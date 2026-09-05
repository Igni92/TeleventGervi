"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Loader2, Plus, Check, X, CalendarDays, Palmtree, Stethoscope, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { LEAVE_TYPES, LEAVE_LABEL, type LeaveType } from "@/lib/rh/leave";

type Leave = {
  id: string; type: string; statut: string; startDate: string; endDate: string; jours: number;
  note: string | null; decisionNote: string | null; origin: string; who?: string;
};
type Balance = { cpSolde: number; recupSoldeMin: number } | null;

const fmt = (iso: string) => new Date(iso).toLocaleDateString("fr-FR", { day: "2-digit", month: "short" });
const STATUT: Record<string, { label: string; cls: string }> = {
  pending: { label: "En attente", cls: "bg-amber-500/15 text-amber-700 dark:text-amber-300" },
  approved: { label: "Validé", cls: "bg-emerald-500/12 text-emerald-700 dark:text-emerald-300" },
  refused: { label: "Refusé", cls: "bg-rose-500/15 text-rose-700 dark:text-rose-300" },
  cancelled: { label: "Annulé", cls: "bg-secondary text-muted-foreground" },
};

export function LeavesPanel() {
  const [mine, setMine] = useState<Leave[]>([]);
  const [team, setTeam] = useState<Leave[] | null>(null);
  const [balance, setBalance] = useState<Balance>(null);
  const [isManager, setIsManager] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  // formulaire (salarié : pose pour soi)
  const [type, setType] = useState<LeaveType>("cp");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [note, setNote] = useState("");
  // formulaire DIRECTION : place un salarié en absence / arrêt maladie
  const [members, setMembers] = useState<{ id: string; name: string; statutEmploi?: string }[]>([]);
  const [pEmp, setPEmp] = useState("");
  const [pType, setPType] = useState<LeaveType>("maladie");
  const [pStart, setPStart] = useState("");
  const [pEnd, setPEnd] = useState("");
  const [pNote, setPNote] = useState("");
  const [pBusy, setPBusy] = useState(false);

  const load = useCallback(async () => {
    const r = await fetch("/api/rh/leaves", { cache: "no-store" });
    const j = await r.json();
    if (r.ok && j.ok) { setMine(j.leaves); setBalance(j.balance); setIsManager(j.isManager); if (j.isManager) { loadTeam(); loadMembers(); } }
    setLoading(false);
  }, []);
  const loadTeam = async () => {
    const r = await fetch("/api/rh/leaves?scope=team", { cache: "no-store" });
    const j = await r.json();
    if (r.ok && j.ok) setTeam(j.leaves);
  };
  // Liste des salariés (direction) — pour placer quelqu'un en absence.
  const loadMembers = async () => {
    const r = await fetch("/api/rh/team", { cache: "no-store" });
    const j = await r.json();
    if (r.ok && j.ok) setMembers((j.team ?? []).map((t: { id: string; name: string; statutEmploi?: string }) => ({ id: t.id, name: t.name, statutEmploi: t.statutEmploi })));
  };
  useEffect(() => { load(); }, [load]);

  const request = async () => {
    if (!start || !end) { toast.error("Dates requises"); return; }
    setBusy(true);
    try {
      const r = await fetch("/api/rh/leaves", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "request", type, startDate: start, endDate: end, note: note || undefined }) });
      const j = await r.json();
      if (!r.ok || !j.ok) { toast.error(j.error || "Échec"); return; }
      toast.success(`Congé demandé (${j.leave.jours} j ouvrables)`);
      setStart(""); setEnd(""); setNote(""); load();
    } finally { setBusy(false); }
  };
  const cancel = async (id: string) => {
    await fetch("/api/rh/leaves", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "cancel", id }) });
    load();
  };
  const decide = async (id: string, decision: "approved" | "refused") => {
    await fetch("/api/rh/leaves", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "decide", id, decision }) });
    loadTeam(); load();
  };
  const removeLeave = async (id: string) => {
    if (!confirm("Supprimer définitivement ce congé ?")) return;
    await fetch("/api/rh/leaves", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "delete", id }) });
    load(); if (isManager) loadTeam();
  };
  // Direction : place un salarié en absence (arrêt maladie…), validé d'office.
  const postAbsence = async () => {
    if (!pEmp) { toast.error("Choisis un salarié"); return; }
    if (!pStart || !pEnd) { toast.error("Dates requises"); return; }
    setPBusy(true);
    try {
      const r = await fetch("/api/rh/leaves", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "post", employeeId: pEmp, type: pType, startDate: pStart, endDate: pEnd, note: pNote || undefined }) });
      const j = await r.json();
      if (!r.ok || !j.ok) { toast.error(j.error || "Échec"); return; }
      const who = members.find((m) => m.id === pEmp)?.name ?? "Salarié";
      toast.success(`${who} placé·e en ${LEAVE_LABEL[pType]} (${j.leave.jours} j)`);
      setPStart(""); setPEnd(""); setPNote(""); loadTeam(); load();
    } finally { setPBusy(false); }
  };

  if (loading) return <div className="flex justify-center py-20"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;
  const pendingTeam = (team ?? []).filter((l) => l.statut === "pending");

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      {/* File à valider (direction) */}
      {isManager && pendingTeam.length > 0 && (
        <div className="rounded-xl border border-amber-500/40 bg-amber-500/[0.06] p-4">
          <h3 className="text-[13px] font-semibold text-amber-700 dark:text-amber-300 mb-2">À valider ({pendingTeam.length})</h3>
          <ul className="space-y-2">
            {pendingTeam.map((l) => (
              <li key={l.id} className="flex items-center justify-between gap-3 rounded-lg bg-card border border-border px-3 py-2">
                <div className="min-w-0">
                  <span className="font-semibold text-foreground">{l.who}</span>
                  <span className="text-[12px] text-muted-foreground"> · {LEAVE_LABEL[l.type as LeaveType] ?? l.type} · {fmt(l.startDate)}→{fmt(l.endDate)} · {l.jours} j</span>
                  {l.note && <div className="text-[11px] text-muted-foreground italic">« {l.note} »</div>}
                </div>
                <div className="flex gap-1.5 shrink-0">
                  <Button size="sm" onClick={() => decide(l.id, "approved")}><Check className="h-4 w-4" /> Valider</Button>
                  <Button size="sm" variant="outline" onClick={() => decide(l.id, "refused")}><X className="h-4 w-4" /></Button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Direction : placer un salarié en absence / arrêt maladie */}
      {isManager && (
        <div className="rounded-2xl border border-sky-500/40 bg-sky-500/[0.05] p-4 space-y-3">
          <h3 className="text-[13px] font-semibold text-sky-700 dark:text-sky-300 flex items-center gap-2">
            <Stethoscope className="h-4 w-4" /> Placer un salarié en absence
          </h3>
          <p className="text-[11.5px] text-muted-foreground -mt-1">
            Arrêt maladie ou autre absence posée par la direction — validée d&apos;office, sans demande du salarié.
          </p>
          <div className="grid gap-2 sm:grid-cols-2">
            <select value={pEmp} onChange={(e) => setPEmp(e.target.value)} className="h-9 rounded-md border border-input bg-background px-2 text-body">
              <option value="">— Salarié —</option>
              {members.filter((m) => m.statutEmploi !== "sorti").map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
            <select value={pType} onChange={(e) => setPType(e.target.value as LeaveType)} className="h-9 rounded-md border border-input bg-background px-2 text-body">
              {LEAVE_TYPES.map((t) => <option key={t} value={t}>{LEAVE_LABEL[t]}</option>)}
            </select>
            <Input type="date" value={pStart} onChange={(e) => setPStart(e.target.value)} />
            <Input type="date" value={pEnd} onChange={(e) => setPEnd(e.target.value)} />
          </div>
          <Input value={pNote} onChange={(e) => setPNote(e.target.value)} placeholder="Note (n° d'arrêt, médecin, remarque…) — optionnel" />
          <Button onClick={postAbsence} disabled={pBusy} className="w-full sm:w-auto">
            {pBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />} Placer en absence
          </Button>
        </div>
      )}

      {/* Solde + formulaire */}
      <div className="rounded-2xl border border-border bg-card p-4 space-y-3">
        <div className="flex items-center gap-4">
          <span className="inline-flex items-center gap-2 text-[13px] text-muted-foreground"><Palmtree className="h-4 w-4" /> Solde CP</span>
          <span className="text-[20px] font-bold tnum text-foreground">{(balance?.cpSolde ?? 0).toFixed(1)} j</span>
        </div>
        <div className="grid gap-2 sm:grid-cols-4">
          <select value={type} onChange={(e) => setType(e.target.value as LeaveType)} className="h-9 rounded-md border border-input bg-background px-2 text-body">
            {LEAVE_TYPES.map((t) => <option key={t} value={t}>{LEAVE_LABEL[t]}</option>)}
          </select>
          <Input type="date" value={start} onChange={(e) => setStart(e.target.value)} />
          <Input type="date" value={end} onChange={(e) => setEnd(e.target.value)} />
          <Button onClick={request} disabled={busy}>{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />} Poser</Button>
        </div>
        <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Motif / note (optionnel)" />
      </div>

      {/* Mes congés */}
      <div>
        <h3 className="text-[13px] font-semibold text-foreground flex items-center gap-2 mb-2"><CalendarDays className="h-4 w-4" /> Mes congés</h3>
        <ul className="space-y-2">
          {mine.map((l) => {
            const s = STATUT[l.statut] ?? STATUT.pending;
            return (
              <li key={l.id} className="flex items-center justify-between gap-3 rounded-lg border border-border bg-card px-3 py-2">
                <div className="min-w-0">
                  <span className="font-medium text-foreground">{LEAVE_LABEL[l.type as LeaveType] ?? l.type}</span>
                  <span className="text-[12px] text-muted-foreground"> · {fmt(l.startDate)}→{fmt(l.endDate)} · {l.jours} j</span>
                  {l.decisionNote && <div className="text-[11px] text-muted-foreground italic">Réponse : {l.decisionNote}</div>}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span className={`rounded-md px-2 py-0.5 text-[11.5px] font-semibold ${s.cls}`}>{s.label}</span>
                  {l.statut === "pending" && <button type="button" onClick={() => cancel(l.id)} className="text-[11px] text-muted-foreground hover:text-destructive">Annuler</button>}
                  {isManager && <button type="button" onClick={() => removeLeave(l.id)} title="Supprimer" className="text-[11px] text-muted-foreground hover:text-destructive">Suppr.</button>}
                </div>
              </li>
            );
          })}
          {mine.length === 0 && <li className="text-center text-muted-foreground py-6 text-[13px]">Aucun congé posé.</li>}
        </ul>
      </div>

      {/* Absences de l'équipe (direction) — hors file « À valider » déjà en tête */}
      {isManager && (team ?? []).filter((l) => l.statut !== "pending").length > 0 && (
        <div>
          <h3 className="text-[13px] font-semibold text-foreground flex items-center gap-2 mb-2"><Users className="h-4 w-4" /> Absences de l&apos;équipe</h3>
          <ul className="space-y-2">
            {(team ?? []).filter((l) => l.statut !== "pending").map((l) => {
              const s = STATUT[l.statut] ?? STATUT.approved;
              return (
                <li key={l.id} className="flex items-center justify-between gap-3 rounded-lg border border-border bg-card px-3 py-2">
                  <div className="min-w-0">
                    <span className="font-semibold text-foreground">{l.who}</span>
                    <span className="text-[12px] text-muted-foreground"> · {LEAVE_LABEL[l.type as LeaveType] ?? l.type} · {fmt(l.startDate)}→{fmt(l.endDate)} · {l.jours} j</span>
                    {l.origin === "direction" && <span className="ml-1.5 rounded bg-sky-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-sky-700 dark:text-sky-300">direction</span>}
                    {l.note && <div className="text-[11px] text-muted-foreground italic">« {l.note} »</div>}
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className={`rounded-md px-2 py-0.5 text-[11.5px] font-semibold ${s.cls}`}>{s.label}</span>
                    <button type="button" onClick={() => removeLeave(l.id)} title="Supprimer" className="text-[11px] text-muted-foreground hover:text-destructive">Suppr.</button>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
