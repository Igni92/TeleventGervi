"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Loader2, LogOut, RotateCcw, StickyNote, FileSignature, UserCheck, Plane, Plus, CalendarDays, Pencil, Check, Upload, Download, Trash2, FileText, Lock, Paperclip, Clock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ScheduleDialog } from "@/components/rh/ScheduleDialog";

type Contract = { id: string; type: string; statut: string; dateDebut: string; dateFin: string | null; essaiFin: string | null; heuresHebdo: number; saisonLabel: string | null; horairesJson?: string | null; annualise?: boolean };
type Event = { id: string; type: string; date: string; meta: string | null; createdBy: string | null };
type Doc = { id: string; type: string; nom: string; mime: string | null; visibleSalarie: boolean; createdAt: string; uploadedBy: string | null; contractId: string | null };
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
/** Contrats à durée indéterminée : aucune date de fin (juridiquement) — sauf fin de contrat. */
const OPEN_ENDED = new Set(["CDI", "ADMINISTRATEUR"]);

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
  const [addCt, setAddCt] = useState(false);
  const [editContract, setEditContract] = useState<Contract | null>(null);
  const [schedContract, setSchedContract] = useState<Contract | null>(null);
  // Cible de l'upload en cours : coffre-fort général (contractId null) ou contrat précis.
  const pendingUpload = useRef<{ contractId: string | null; type: string }>({ contractId: null, type: "contrat" });

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

  const deleteContract = async (cid: string) => {
    if (!confirm("Supprimer ce contrat ? (correction — action définitive)")) return;
    const r = await fetch(`/api/rh/contracts/${cid}`, { method: "DELETE" });
    const j = await r.json();
    if (!r.ok || !j.ok) { toast.error(j.error || "Échec"); return; }
    toast.success("Contrat supprimé"); setEditContract(null); load();
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

  // Déclenche le sélecteur de fichier pour une cible donnée (coffre-fort ou contrat).
  const pickFile = (contractId: string | null, type: string) => { pendingUpload.current = { contractId, type }; fileRef.current?.click(); };
  const upload = async (file: File) => {
    if (file.size > 8 * 1024 * 1024) { toast.error("Fichier trop lourd (max 8 Mo)"); return; }
    const { contractId, type } = pendingUpload.current;
    const contenu = await new Promise<string>((res, rej) => { const fr = new FileReader(); fr.onload = () => res(String(fr.result)); fr.onerror = rej; fr.readAsDataURL(file); });
    const r = await fetch(`/api/rh/employees/${id}/documents`, { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type, nom: file.name, mime: file.type, contenu, contractId: contractId ?? undefined }) });
    const j = await r.json();
    if (!r.ok || !j.ok) { toast.error(j.error || "Échec du dépôt"); return; }
    toast.success(contractId ? "Document rattaché au contrat" : "Document ajouté"); setDocs((c) => [j.document, ...c]);
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

      {/* Contrats — éditables (type, dates, heures) + ajout/suppression (correction direction) */}
      <section>
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-[13px] font-semibold text-foreground">Contrats</h3>
          <Button size="sm" variant="outline" onClick={() => setAddCt(true)}><Plus className="h-3.5 w-3.5" /> Ajouter</Button>
        </div>
        <ul className="space-y-1.5">
          {emp.contracts.map((c) => {
            const ctDocs = docs.filter((d) => d.contractId === c.id);
            return (
            <li key={c.id} className="rounded-lg border border-border bg-card px-3 py-2 text-[13px]">
              <div className="flex items-center justify-between gap-3">
                <span><b className="text-foreground">{c.type}</b> · {c.heuresHebdo}h/sem{c.saisonLabel ? ` · ${c.saisonLabel}` : ""}</span>
                <span className="flex items-center gap-2 text-muted-foreground tnum">
                  {fmt(c.dateDebut)}{c.dateFin ? ` → ${fmt(c.dateFin)}` : ""}
                  <span className={`rounded px-1.5 py-0.5 text-[11px] ${c.statut === "actif" ? "bg-emerald-500/12 text-emerald-700 dark:text-emerald-300" : "bg-secondary text-muted-foreground"}`}>{c.statut}</span>
                  <button type="button" onClick={() => setSchedContract(c)} title="Horaires & modulation" className="text-muted-foreground hover:text-primary"><Clock className="h-3.5 w-3.5" /></button>
                  <button type="button" onClick={() => pickFile(c.id, "contrat")} title="Rattacher un document à ce contrat" className="text-muted-foreground hover:text-primary"><Paperclip className="h-3.5 w-3.5" /></button>
                  <button type="button" onClick={() => setEditContract(c)} title="Modifier le contrat" className="text-muted-foreground hover:text-primary"><Pencil className="h-3 w-3" /></button>
                </span>
              </div>
              {/* Documents rattachés à CE contrat */}
              {ctDocs.length > 0 && (
                <ul className="mt-1.5 space-y-1 border-t border-border/60 pt-1.5">
                  {ctDocs.map((d) => (
                    <li key={d.id} className="flex items-center justify-between gap-2 text-[12px]">
                      <span className="inline-flex items-center gap-1.5 min-w-0 text-muted-foreground">
                        <FileText className="h-3.5 w-3.5 shrink-0" /><span className="truncate text-foreground">{d.nom}</span>
                        <span className="shrink-0">· {fmt(d.createdAt)}</span>
                      </span>
                      <span className="flex items-center gap-0.5 shrink-0">
                        <button type="button" onClick={() => download(d.id)} title="Télécharger" className="h-7 w-7 rounded-md flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-secondary"><Download className="h-3.5 w-3.5" /></button>
                        <button type="button" onClick={() => delDoc(d.id)} title="Supprimer" className="h-7 w-7 rounded-md flex items-center justify-center text-muted-foreground hover:text-destructive hover:bg-destructive/10"><Trash2 className="h-3.5 w-3.5" /></button>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </li>
            );
          })}
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
            <Button size="sm" variant="outline" onClick={() => pickFile(null, uploadType)}><Upload className="h-3.5 w-3.5" /> Déposer</Button>
          </div>
        </div>
        <ul className="space-y-1.5">
          {docs.filter((d) => !d.contractId).map((d) => (
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
          {docs.filter((d) => !d.contractId).length === 0 && <li className="text-[13px] text-muted-foreground">Aucun document général. Dépose un bulletin, une attestation… ou rattache un document à un contrat via l&apos;icône trombone.</li>}
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
      {addCt && <ContractDialog employeeId={id} onClose={() => setAddCt(false)} onSaved={() => { setAddCt(false); load(); }} />}
      {editContract && <ContractDialog employeeId={id} contract={editContract} onClose={() => setEditContract(null)} onSaved={() => { setEditContract(null); load(); }} onDelete={() => deleteContract(editContract.id)} />}
      {schedContract && <ScheduleDialog contract={schedContract} onClose={() => setSchedContract(null)} onSaved={() => { setSchedContract(null); load(); }} />}
    </div>
  );
}

/** Ajout OU édition d'un contrat. Sans `contract` = ajout (POST). Avec `contract`
 *  = modification (PATCH) d'un contrat déjà rentré, tous champs éditables + suppression. */
function ContractDialog({ employeeId, contract, onClose, onSaved, onDelete }: {
  employeeId: string; contract?: Contract; onClose: () => void; onSaved: () => void; onDelete?: () => void;
}) {
  const editMode = !!contract;
  const [type, setType] = useState(contract?.type ?? "CDI");
  const [statut, setStatut] = useState(contract?.statut ?? "actif");
  const [dateDebut, setDateDebut] = useState(contract ? dISO(contract.dateDebut) : new Date().toISOString().slice(0, 10));
  const [dateFin, setDateFin] = useState(contract ? dISO(contract.dateFin) : "");
  const [essaiFin, setEssaiFin] = useState(contract ? dISO(contract.essaiFin) : "");
  const [heuresHebdo, setHeuresHebdo] = useState(String(contract?.heuresHebdo ?? 35));
  const [saisonLabel, setSaisonLabel] = useState(contract?.saisonLabel ?? "");
  const [annualise, setAnnualise] = useState(contract?.annualise !== false);
  const [cloturer, setCloturer] = useState(true);
  const [saving, setSaving] = useState(false);
  const openEnded = OPEN_ENDED.has(type);
  const seasonal = type === "CDD" || type === "SAISONNIER";

  const submit = async () => {
    setSaving(true);
    try {
      if (editMode) {
        const body: Record<string, unknown> = {
          type, statut, dateDebut, essaiFin: essaiFin || null,
          heuresHebdo: Number(heuresHebdo) || 35, saisonLabel: seasonal ? (saisonLabel || null) : null,
          dateFin: openEnded ? null : (dateFin || null), annualise,
        };
        const r = await fetch(`/api/rh/contracts/${contract!.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
        const j = await r.json();
        if (!r.ok || !j.ok) { toast.error(j.error || "Échec"); return; }
        toast.success("Contrat mis à jour"); onSaved();
      } else {
        const r = await fetch("/api/rh/contracts", { method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ employeeId, type, dateDebut, dateFin: openEnded ? undefined : (dateFin || undefined), essaiFin: essaiFin || undefined, heuresHebdo: Number(heuresHebdo) || 35, saisonLabel: seasonal ? (saisonLabel || undefined) : undefined, annualise, cloturerPrecedents: cloturer }) });
        const j = await r.json();
        if (!r.ok || !j.ok) { toast.error(j.error || "Échec"); return; }
        toast.success("Contrat ajouté"); onSaved();
      }
    } finally { setSaving(false); }
  };
  return (
    <Dialog open onOpenChange={(o) => { if (!o && !saving) onClose(); }}>
      <DialogContent size="sm">
        <DialogHeader className="text-left"><DialogTitle className="flex items-center gap-2"><FileSignature className="h-5 w-5" /> {editMode ? "Modifier le contrat" : "Ajouter un contrat"}</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-2">
            <label className="block"><span className="text-caption font-medium">Type</span>
              <select value={type} onChange={(e) => setType(e.target.value)} className="mt-1 h-9 w-full rounded-md border border-input bg-background px-2 text-body">
                {CONTRACT_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </label>
            <label className="block"><span className="text-caption font-medium">Heures/sem</span><Input type="number" value={heuresHebdo} onChange={(e) => setHeuresHebdo(e.target.value)} className="mt-1" /></label>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <label className="block"><span className="text-caption font-medium">Début</span><Input type="date" value={dateDebut} onChange={(e) => setDateDebut(e.target.value)} className="mt-1" /></label>
            {!openEnded && <label className="block"><span className="text-caption font-medium">Fin (CDD/saison)</span><Input type="date" value={dateFin} onChange={(e) => setDateFin(e.target.value)} className="mt-1" /></label>}
          </div>
          <div className="grid grid-cols-2 gap-2">
            <label className="block"><span className="text-caption font-medium">Fin période d&apos;essai</span><Input type="date" value={essaiFin} onChange={(e) => setEssaiFin(e.target.value)} className="mt-1" /></label>
            {seasonal && <label className="block"><span className="text-caption font-medium">Libellé saison</span><Input value={saisonLabel} onChange={(e) => setSaisonLabel(e.target.value)} placeholder="Saison fraises 2026" className="mt-1" /></label>}
            {editMode && (
              <label className="block"><span className="text-caption font-medium">Statut</span>
                <select value={statut} onChange={(e) => setStatut(e.target.value)} className="mt-1 h-9 w-full rounded-md border border-input bg-background px-2 text-body">
                  <option value="actif">actif</option>
                  <option value="termine">terminé</option>
                  <option value="brouillon">brouillon</option>
                </select>
              </label>
            )}
          </div>
          {openEnded && <p className="text-[11px] text-muted-foreground">{type} = durée indéterminée : aucune date de fin (elle n&apos;apparaîtra qu&apos;à la fin de contrat).</p>}
          <label className="flex items-center gap-2 text-caption text-foreground">
            <input type="checkbox" checked={annualise} onChange={(e) => setAnnualise(e.target.checked)} />
            Annualiser le temps de travail (IDCC 1405, 1600 h)
          </label>
          {!annualise && <p className="text-[11px] text-muted-foreground -mt-1">Décoché : les heures sont décomptées à la semaine (majorations hebdo), sans régularisation annuelle 1600 h.</p>}
          {!editMode && (
            <label className="flex items-center gap-2 text-caption text-foreground">
              <input type="checkbox" checked={cloturer} onChange={(e) => setCloturer(e.target.checked)} />
              Clôturer le(s) contrat(s) actif(s) précédent(s)
            </label>
          )}
          <div className="flex items-center gap-2 pt-1">
            {editMode && onDelete && (
              <Button variant="outline" size="xl" onClick={onDelete} disabled={saving} className="text-destructive hover:text-destructive"><Trash2 className="h-4 w-4" /></Button>
            )}
            <Button variant="outline" size="xl" onClick={onClose} disabled={saving} className="flex-1">Annuler</Button>
            <Button size="xl" onClick={submit} disabled={saving} className="flex-1">{saving ? <Loader2 className="h-4 w-4 animate-spin" /> : editMode ? <Check className="h-4 w-4" /> : <Plus className="h-4 w-4" />} {editMode ? "Enregistrer" : "Ajouter"}</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
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
