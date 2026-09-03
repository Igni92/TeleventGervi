"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Loader2, LogOut, RotateCcw, StickyNote, FileSignature, UserCheck, Plane, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

type Contract = { id: string; type: string; statut: string; dateDebut: string; dateFin: string | null; essaiFin: string | null; heuresHebdo: number; saisonLabel: string | null };
type Event = { id: string; type: string; date: string; meta: string | null; createdBy: string | null };
type Leave = { id: string; type: string; statut: string; startDate: string; endDate: string; jours: number };
type Emp = {
  id: string; email: string; displayName: string | null; poste: string | null; service: string | null;
  sapSlpName: string | null; statutEmploi: string; hireDate: string | null; exitDate: string | null; exitReason: string | null;
  contracts: Contract[]; events: Event[]; leaves: Leave[];
};

const fmt = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("fr-FR", { day: "2-digit", month: "short", year: "numeric" }) : "—");
const EVENT_META: Record<string, { label: string; icon: React.ReactNode; cls: string }> = {
  embauche: { label: "Embauche", icon: <UserCheck className="h-4 w-4" />, cls: "text-emerald-600 dark:text-emerald-400" },
  contrat: { label: "Contrat", icon: <FileSignature className="h-4 w-4" />, cls: "text-sky-600 dark:text-sky-400" },
  absence: { label: "Absence / congé", icon: <Plane className="h-4 w-4" />, cls: "text-amber-600 dark:text-amber-400" },
  depart: { label: "Départ", icon: <LogOut className="h-4 w-4" />, cls: "text-rose-600 dark:text-rose-400" },
  retour: { label: "Ré-activation", icon: <RotateCcw className="h-4 w-4" />, cls: "text-emerald-600 dark:text-emerald-400" },
  note: { label: "Note", icon: <StickyNote className="h-4 w-4" />, cls: "text-muted-foreground" },
};

function metaText(e: Event): string | null {
  if (!e.meta) return null;
  try {
    const m = JSON.parse(e.meta);
    if (m.text) return m.text;
    if (m.reason) return `Motif : ${m.reason}`;
    if (m.contractType) return `${m.contractType}`;
    if (m.leaveType) return `${m.leaveType} · ${m.jours ?? "?"} j`;
  } catch { /* ignore */ }
  return null;
}

export function EmployeeFiche({ id }: { id: string }) {
  const [emp, setEmp] = useState<Emp | null>(null);
  const [loading, setLoading] = useState(true);
  const [departOpen, setDepartOpen] = useState(false);
  const [note, setNote] = useState("");

  const load = useCallback(async () => {
    const r = await fetch(`/api/rh/employees/${id}`, { cache: "no-store" });
    const j = await r.json();
    if (r.ok && j.ok) setEmp(j.employee);
    setLoading(false);
  }, [id]);
  useEffect(() => { load(); }, [load]);

  const action = async (body: Record<string, unknown>, ok: string) => {
    const r = await fetch(`/api/rh/employees/${id}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const j = await r.json();
    if (!r.ok || !j.ok) { toast.error(j.error || "Échec"); return false; }
    toast.success(ok); load(); return true;
  };

  if (loading) return <div className="flex justify-center py-20"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;
  if (!emp) return <p className="text-center text-muted-foreground py-16">Salarié introuvable.</p>;

  const sorti = emp.statutEmploi === "sorti";

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      {/* En-tête fiche */}
      <div className="rounded-2xl border border-border bg-card p-5">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <h2 className="text-[20px] font-bold text-foreground">{emp.displayName ?? emp.email}
              {emp.sapSlpName && <span className="ml-2 text-[11px] font-mono text-muted-foreground">{emp.sapSlpName}</span>}
            </h2>
            <p className="text-[13px] text-muted-foreground">{[emp.poste, emp.service].filter(Boolean).join(" · ") || emp.email}</p>
            <p className="text-[12px] text-muted-foreground mt-1">
              Entrée {fmt(emp.hireDate)}{sorti ? ` · Sortie ${fmt(emp.exitDate)}${emp.exitReason ? ` (${emp.exitReason})` : ""}` : ""}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <span className={`rounded-md px-2 py-1 text-[12px] font-semibold ${sorti ? "bg-secondary text-muted-foreground" : "bg-emerald-500/12 text-emerald-700 dark:text-emerald-300"}`}>
              {sorti ? "Sorti" : "Actif"}
            </span>
            {sorti ? (
              <Button size="sm" variant="outline" onClick={() => action({ action: "reactivate" }, "Salarié ré-activé")}><RotateCcw className="h-4 w-4" /> Ré-activer</Button>
            ) : (
              <Button size="sm" variant="outline" onClick={() => setDepartOpen(true)}><LogOut className="h-4 w-4" /> Fin de contrat</Button>
            )}
          </div>
        </div>
      </div>

      {/* Contrats */}
      <section>
        <h3 className="text-[13px] font-semibold text-foreground mb-2">Contrats</h3>
        <ul className="space-y-1.5">
          {emp.contracts.map((c) => (
            <li key={c.id} className="flex items-center justify-between gap-3 rounded-lg border border-border bg-card px-3 py-2 text-[13px]">
              <span><b className="text-foreground">{c.type}</b> · {c.heuresHebdo}h/sem{c.saisonLabel ? ` · ${c.saisonLabel}` : ""}</span>
              <span className="text-muted-foreground tnum">{fmt(c.dateDebut)}{c.dateFin ? ` → ${fmt(c.dateFin)}` : ""}
                <span className={`ml-2 rounded px-1.5 py-0.5 text-[11px] ${c.statut === "actif" ? "bg-emerald-500/12 text-emerald-700 dark:text-emerald-300" : "bg-secondary text-muted-foreground"}`}>{c.statut}</span>
              </span>
            </li>
          ))}
          {emp.contracts.length === 0 && <li className="text-[13px] text-muted-foreground">Aucun contrat.</li>}
        </ul>
      </section>

      {/* Journal du salarié (évènements) */}
      <section>
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-[13px] font-semibold text-foreground">Registre</h3>
          <div className="flex items-center gap-1.5">
            <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Ajouter une note…" className="h-8 w-52" />
            <Button size="sm" variant="outline" onClick={async () => { if (await action({ action: "note", text: note }, "Note ajoutée")) setNote(""); }} disabled={!note.trim()}><Plus className="h-3.5 w-3.5" /></Button>
          </div>
        </div>
        <ol className="relative border-l border-border ml-2 space-y-3">
          {emp.events.map((e) => {
            const m = EVENT_META[e.type] ?? EVENT_META.note;
            const txt = metaText(e);
            return (
              <li key={e.id} className="ml-4">
                <span className={`absolute -left-[9px] flex h-4 w-4 items-center justify-center rounded-full bg-card ring-2 ring-border ${m.cls}`} />
                <div className="flex items-center gap-2">
                  <span className={m.cls}>{m.icon}</span>
                  <span className="text-[13px] font-medium text-foreground">{m.label}</span>
                  <span className="text-[11px] text-muted-foreground tnum">{fmt(e.date)}</span>
                </div>
                {txt && <p className="text-[12px] text-muted-foreground ml-6">{txt}</p>}
              </li>
            );
          })}
          {emp.events.length === 0 && <li className="ml-4 text-[13px] text-muted-foreground">Aucun évènement.</li>}
        </ol>
      </section>

      {/* Dialog fin de contrat */}
      {departOpen && <DepartDialog onClose={() => setDepartOpen(false)} onConfirm={async (exitDate, exitReason) => { if (await action({ action: "depart", exitDate, exitReason }, "Fin de contrat enregistrée")) setDepartOpen(false); }} />}
    </div>
  );
}

function DepartDialog({ onClose, onConfirm }: { onClose: () => void; onConfirm: (d: string, r: string) => void }) {
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [reason, setReason] = useState("");
  const REASONS = ["Fin de CDD", "Démission", "Licenciement", "Rupture conventionnelle", "Fin de période d'essai", "Retraite", "Autre"];
  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent size="sm">
        <DialogHeader className="text-left">
          <DialogTitle className="flex items-center gap-2"><LogOut className="h-5 w-5" /> Fin de contrat</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <label className="block"><span className="text-caption font-medium">Date de sortie</span><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="mt-1" /></label>
          <label className="block"><span className="text-caption font-medium">Motif</span>
            <select value={reason} onChange={(e) => setReason(e.target.value)} className="mt-1 h-9 w-full rounded-md border border-input bg-background px-2 text-body">
              <option value="">— choisir —</option>
              {REASONS.map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
          </label>
          <div className="grid grid-cols-2 gap-2 pt-1">
            <Button variant="outline" size="xl" onClick={onClose}>Annuler</Button>
            <Button size="xl" onClick={() => onConfirm(date, reason)}><LogOut className="h-4 w-4" /> Confirmer</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
