"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Loader2, LogOut, RotateCcw, StickyNote, FileSignature, UserCheck, Plane, Plus, CalendarDays, Pencil, Check, Upload, Download, Trash2, FileText, Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

type Contract = { id: string; type: string; statut: string; dateDebut: string; dateFin: string | null; essaiFin: string | null; heuresHebdo: number; saisonLabel: string | null };
type Event = { id: string; type: string; date: string; meta: string | null; createdBy: string | null };
type Doc = { id: string; type: string; nom: string; mime: string | null; visibleSalarie: boolean; createdAt: string; uploadedBy: string | null };
type Emp = {
  id: string; email: string; displayName: string | null; poste: string | null; service: string | null;
  sapSlpName: string | null; statutEmploi: string; hireDate: string | null; exitDate: string | null; exitReason: string | null;
  contracts: Contract[]; events: Event[];
};

const fmt = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("fr-FR", { day: "2-digit", month: "short", year: "numeric" }) : "—");
const dISO = (iso: string | null) => (iso ? new Date(iso).toISOString().slice(0, 10) : "");
const EVENT_META: Record<string, { label: string; icon: React.ReactNode; cls: string }> = {
  embauche: { label: "Embauche", icon: <UserCheck className="h-4 w-4" />, cls: "text-emerald-600 dark:text-emerald-400" },
  contrat: { label: "Contrat", icon: <FileSignature className="h-4 w-4" />, cls: "text-sky-600 dark:text-sky-400" },
  absence: { label: "Absence / congé", icon: <Plane className="h-4 w-4" />, cls: "text-amber-600 dark:text-amber-400" },
  depart: { label: "Départ", icon: <LogOut className="h-4 w-4" />, cls: "text-rose-600 dark:text-rose-400" },
  retour: { label: "Ré-activation", icon: <RotateCcw className="h-4 w-4" />, cls: "text-emerald-600 dark:text-emerald-400" },
  note: { label: "Note", icon: <StickyNote className="h-4 w-4" />, cls: "text-muted-foreground" },
};
const DOC_LABEL: Record<string, string> = { contrat: "Contrat", bulletin: "Bulletin", attestation: "Attestation", justificatif: "Justificatif", autre: "Autre" };
const CONTRACT_TYPES = ["CDI", "CDD", "SAISONNIER", "APPRENTISSAGE", "INTERIM", "STAGE", "ADMINISTRATEUR"];

function metaText(e: Event): string | null {
  if (!e.meta) return null;
  try {
    const m = JSON.parse(e.meta);
    if (m.text) return m.text;
    if (m.reason) return `Motif : ${m.reason}`;
    if (m.contractType) return `${m.contractType}`;
    // Congé : uniquement la PÉRIODE (début → fin), pas de décompte parasite.
    if (m.leaveType) {
      if (m.start && m.end) return `du ${fmt(m.start)} au ${fmt(m.end)}`;
      return String(m.leaveType);
    }
  } catch { /* ignore */ }
  return null;
}

export function EmployeeFiche({ id }: { id: string }) {
  const [emp, setEmp] = useState<Emp | null>(null);
  const [docs, setDocs] = useState<Doc[]>([]);
  const [loading, setLoading] = useState(true);
  const [departOpen, setDepartOpen] = useState(false);
  const [note, setNote] = useState("");
  const [editHire, setEditHire] = useState(false);
  const [hireVal, setHireVal] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploadType, setUploadType] = useState("contrat");
  const [editCt, setEditCt] = useState<string | null>(null);
  const editVals = useRef<Record<string, unknown>>({});

  const load = useCallback(async () => {
    const [r, rd] = await Promise.all([
      fetch(`/api/rh/employees/${id}`, { cache: "no-store" }),
      fetch(`/api/rh/employees/${id}/documents`, { cache: "no-store" }),
    ]);
    const j = await r.json(); const jd = await rd.json().catch(() => null);
    if (r.ok && j.ok) { setEmp(j.employee); setHireVal(dISO(j.employee.hireDate)); }
    if (jd?.ok) setDocs(jd.documents);
    setLoading(false);
  }, [id]);
  useEffect(() => { load(); }, [load]);

  const action = async (body: Record<string, unknown>, ok: string) => {
    const r = await fetch(`/api/rh/employees/${id}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const j = await r.json();
    if (!r.ok || !j.ok) { toast.error(j.error || "Échec"); return false; }
    toast.success(ok); load(); return true;
  };

  const patchContract = async (cid: string) => {
    const v = editVals.current;
    if (Object.keys(v).length === 0) { setEditCt(null); return; }
    const r = await fetch(`/api/rh/contracts/${cid}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(v) });
    const j = await r.json();
    if (!r.ok || !j.ok) { toast.error(j.error || "Échec"); return; }
    toast.success("Contrat mis à jour"); setEditCt(null); editVals.current = {}; load();
  };

  const saveHire = async () => {
    // Garde-fou : date valide et pas dans un futur lointain (> 1 an).
    if (hireVal) {
      const d = new Date(hireVal);
      if (Number.isNaN(d.getTime())) { toast.error("Date invalide"); return; }
      if (d.getTime() > Date.now() + 366 * 86400_000) { toast.error("Date d'entrée trop loin dans le futur"); return; }
    }
    if (await action({ action: "update", hireDate: hireVal || null }, "Date d'entrée mise à jour")) setEditHire(false);
  };

  const upload = async (file: File) => {
    if (file.size > 8 * 1024 * 1024) { toast.error("Fichier trop lourd (max 8 Mo)"); return; }
    const contenu = await new Promise<string>((res, rej) => { const fr = new FileReader(); fr.onload = () => res(String(fr.result)); fr.onerror = rej; fr.readAsDataURL(file); });
    const r = await fetch(`/api/rh/employees/${id}/documents`, { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: uploadType, nom: file.name, mime: file.type, contenu }) });
    const j = await r.json();
    if (!r.ok || !j.ok) { toast.error(j.error || "Échec du dépôt"); return; }
    toast.success("Document ajouté"); setDocs((c) => [j.document, ...c]);
  };
  const download = async (docId: string) => {
    const r = await fetch(`/api/rh/documents/${docId}`); const j = await r.json();
    if (!r.ok || !j.ok) { toast.error("Téléchargement impossible"); return; }
    const a = document.createElement("a"); a.href = j.contenu; a.download = j.nom; a.click();
  };
  const delDoc = async (docId: string) => {
    if (!confirm("Supprimer ce document ?")) return;
    await fetch(`/api/rh/documents/${docId}`, { method: "DELETE" });
    setDocs((c) => c.filter((d) => d.id !== docId));
  };

  if (loading) return <div className="flex justify-center py-20"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;
  if (!emp) return <p className="text-center text-muted-foreground py-16">Salarié introuvable.</p>;
  const sorti = emp.statutEmploi === "sorti";

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      {/* En-tête */}
      <div className="rounded-2xl border border-border bg-card p-5">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="min-w-0">
            <h2 className="text-[20px] font-bold text-foreground">{emp.displayName ?? emp.email}
              {emp.sapSlpName && <span className="ml-2 text-[11px] font-mono text-muted-foreground">{emp.sapSlpName}</span>}
            </h2>
            <p className="text-[13px] text-muted-foreground">{[emp.poste, emp.service].filter(Boolean).join(" · ") || emp.email}</p>
            {/* Date d'entrée ÉDITABLE (direction) */}
            <div className="text-[12px] text-muted-foreground mt-1 flex items-center gap-2 flex-wrap">
              {editHire ? (
                <>
                  <span>Entrée</span>
                  <Input type="date" value={hireVal} onChange={(e) => setHireVal(e.target.value)} className="h-7 w-40" />
                  <Button size="sm" onClick={saveHire}><Check className="h-3.5 w-3.5" /></Button>
                  <button type="button" onClick={() => { setEditHire(false); setHireVal(dISO(emp.hireDate)); }} className="text-[11px] hover:text-foreground">Annuler</button>
                </>
              ) : (
                <>
                  <CalendarDays className="h-3.5 w-3.5" /> Entrée <b className="text-foreground">{fmt(emp.hireDate)}</b>
                  <button type="button" onClick={() => setEditHire(true)} title="Modifier la date d'entrée" className="text-muted-foreground hover:text-primary"><Pencil className="h-3 w-3" /></button>
                  {sorti && <span>· Sortie <b className="text-foreground">{fmt(emp.exitDate)}</b>{emp.exitReason ? ` (${emp.exitReason})` : ""}</span>}
                </>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className={`rounded-md px-2 py-1 text-[12px] font-semibold ${sorti ? "bg-secondary text-muted-foreground" : "bg-emerald-500/12 text-emerald-700 dark:text-emerald-300"}`}>{sorti ? "Sorti" : "Actif"}</span>
            {sorti
              ? <Button size="sm" variant="outline" onClick={() => action({ action: "reactivate" }, "Salarié ré-activé")}><RotateCcw className="h-4 w-4" /> Ré-activer</Button>
              : <Button size="sm" variant="outline" onClick={() => setDepartOpen(true)}><LogOut className="h-4 w-4" /> Fin de contrat</Button>}
          </div>
        </div>
      </div>

      {/* Contrats — type & heures éditables (direction) */}
      <section>
        <h3 className="text-[13px] font-semibold text-foreground mb-2">Contrats</h3>
        <ul className="space-y-1.5">
          {emp.contracts.map((c) => (
            <li key={c.id} className="flex items-center justify-between gap-3 rounded-lg border border-border bg-card px-3 py-2 text-[13px]">
              {editCt === c.id ? (
                <div className="flex items-center gap-2 flex-wrap flex-1">
                  <select defaultValue={c.type} onChange={(e) => (editVals.current.type = e.target.value)} className="h-8 rounded-md border border-input bg-background px-2 text-body">
                    {CONTRACT_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                  </select>
                  <Input type="number" defaultValue={c.heuresHebdo} onChange={(e) => (editVals.current.heuresHebdo = Number(e.target.value))} className="h-8 w-20" title="Heures/sem" />
                  <Input type="date" defaultValue={dISO(c.dateFin)} onChange={(e) => (editVals.current.dateFin = e.target.value)} className="h-8 w-40" title="Fin (option)" />
                  <Button size="sm" onClick={() => patchContract(c.id)}><Check className="h-3.5 w-3.5" /></Button>
                  <button type="button" onClick={() => setEditCt(null)} className="text-[11px] text-muted-foreground hover:text-foreground">Annuler</button>
                </div>
              ) : (
                <>
                  <span><b className="text-foreground">{c.type}</b> · {c.heuresHebdo}h/sem{c.saisonLabel ? ` · ${c.saisonLabel}` : ""}</span>
                  <span className="flex items-center gap-2 text-muted-foreground tnum">
                    {fmt(c.dateDebut)}{c.dateFin ? ` → ${fmt(c.dateFin)}` : ""}
                    <span className={`rounded px-1.5 py-0.5 text-[11px] ${c.statut === "actif" ? "bg-emerald-500/12 text-emerald-700 dark:text-emerald-300" : "bg-secondary text-muted-foreground"}`}>{c.statut}</span>
                    <button type="button" onClick={() => { setEditCt(c.id); editVals.current = {}; }} title="Modifier le contrat" className="text-muted-foreground hover:text-primary"><Pencil className="h-3 w-3" /></button>
                  </span>
                </>
              )}
            </li>
          ))}
          {emp.contracts.length === 0 && <li className="text-[13px] text-muted-foreground">Aucun contrat.</li>}
        </ul>
      </section>

      {/* COFFRE-FORT documents */}
      <section>
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-[13px] font-semibold text-foreground flex items-center gap-2"><Lock className="h-4 w-4" /> Coffre-fort</h3>
          <div className="flex items-center gap-1.5">
            <select value={uploadType} onChange={(e) => setUploadType(e.target.value)} className="h-8 rounded-md border border-input bg-background px-2 text-caption">
              {Object.entries(DOC_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
            <input ref={fileRef} type="file" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) upload(f); e.target.value = ""; }} />
            <Button size="sm" variant="outline" onClick={() => fileRef.current?.click()}><Upload className="h-3.5 w-3.5" /> Déposer</Button>
          </div>
        </div>
        <ul className="space-y-1.5">
          {docs.map((d) => (
            <li key={d.id} className="flex items-center justify-between gap-3 rounded-lg border border-border bg-card px-3 py-2 text-[13px]">
              <span className="inline-flex items-center gap-2 min-w-0">
                <FileText className="h-4 w-4 text-muted-foreground shrink-0" />
                <span className="min-w-0">
                  <span className="font-medium text-foreground truncate block">{d.nom}</span>
                  <span className="text-[11px] text-muted-foreground">{DOC_LABEL[d.type] ?? d.type} · {fmt(d.createdAt)}{d.visibleSalarie ? " · visible salarié" : " · interne"}</span>
                </span>
              </span>
              <span className="flex items-center gap-1 shrink-0">
                <button type="button" onClick={() => download(d.id)} title="Télécharger" className="h-8 w-8 rounded-md flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-secondary"><Download className="h-4 w-4" /></button>
                <button type="button" onClick={() => delDoc(d.id)} title="Supprimer" className="h-8 w-8 rounded-md flex items-center justify-center text-muted-foreground hover:text-destructive hover:bg-destructive/10"><Trash2 className="h-4 w-4" /></button>
              </span>
            </li>
          ))}
          {docs.length === 0 && <li className="text-[13px] text-muted-foreground">Aucun document. Dépose un contrat, un bulletin, une attestation…</li>}
        </ul>
      </section>

      {/* Registre */}
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
            const m = EVENT_META[e.type] ?? EVENT_META.note; const txt = metaText(e);
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

      {departOpen && <DepartDialog onClose={() => setDepartOpen(false)} onConfirm={async (exitDate, exitReason) => { if (await action({ action: "depart", exitDate, exitReason }, "Fin de contrat enregistrée")) setDepartOpen(false); }} />}
    </div>
  );
}

function DepartDialog({ onClose, onConfirm }: { onClose: () => void; onConfirm: (d: string, r: string) => void }) {
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [reason, setReason] = useState("");
  const REASONS = ["Fin de CDD", "Rupture anticipée", "Démission", "Licenciement", "Rupture conventionnelle", "Fin de période d'essai", "Retraite", "Autre"];
  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent size="sm">
        <DialogHeader className="text-left"><DialogTitle className="flex items-center gap-2"><LogOut className="h-5 w-5" /> Fin de contrat</DialogTitle></DialogHeader>
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
