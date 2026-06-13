"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, Check, Loader2, X } from "lucide-react";
import { SurfaceCard } from "@/components/ui/surface-card";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

/**
 * Incidents de réception marchandise (litige fournisseur sur un BR).
 *
 * - `ReceptionIncidentButton` : bouton par ligne de l'historique BR → dialog
 *   de déclaration (type + note). Affiche le nombre d'incidents ouverts du BR.
 * - `OpenReceptionIncidents` : panneau des incidents ouverts (résolution 1 clic).
 */

export interface ReceptionIncident {
  id: string;
  docEntry: number | null;
  docNum: number | null;
  lot: string | null;
  cardCode: string | null;
  cardName: string | null;
  itemCode: string | null;
  type: string | null;
  note: string | null;
  createdBy: string | null;
  resolved: boolean;
  createdAt: string;
}

export const INCIDENT_TYPES = ["Qualité", "Manquant", "Casse", "Température", "Prix", "Autre"] as const;

/* ─────────────────────────────────────────────────────────────────
   Dialog de déclaration — type (chips) + note libre.
   ───────────────────────────────────────────────────────────────── */
function DeclareDialog({
  receipt, onClose, onCreated,
}: {
  receipt: { docEntry: number; docNum: number; lot?: string; cardCode?: string; cardName?: string };
  onClose: () => void;
  onCreated: () => void;
}) {
  const [type, setType] = useState<string>("Qualité");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose]);

  async function submit() {
    setSaving(true);
    try {
      const res = await fetch("/api/entrees/incidents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          docEntry: receipt.docEntry,
          docNum: receipt.docNum,
          lot: receipt.lot,
          cardCode: receipt.cardCode,
          cardName: receipt.cardName,
          type,
          note,
        }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => null))?.error ?? res.statusText);
      toast.success(`Incident « ${type} » déclaré sur le BR #${receipt.docNum}`);
      onCreated();
      onClose();
    } catch (e) {
      toast.error(`Échec de la déclaration : ${e instanceof Error ? e.message : e}`);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-6" onClick={onClose}>
      <div
        className="bg-card border border-border rounded-xl shadow-2xl w-full max-w-md overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-center justify-between px-5 py-3 border-b border-border">
          <div className="flex items-baseline gap-2">
            <AlertTriangle className="h-4 w-4 text-amber-500 self-center" />
            <h2 className="text-[15px] font-semibold text-foreground">Incident réception</h2>
            <span className="text-[12px] text-muted-foreground">
              BR #{receipt.docNum}{receipt.cardName ? ` · ${receipt.cardName}` : ""}
            </span>
          </div>
          <button onClick={onClose} className="p-1.5 hover:bg-secondary rounded-md text-muted-foreground">
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="p-5 space-y-4">
          <div>
            <p className="text-[10.5px] uppercase tracking-[0.14em] font-semibold text-muted-foreground mb-2">
              Type d&apos;incident
            </p>
            <div className="flex flex-wrap gap-1.5">
              {INCIDENT_TYPES.map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setType(t)}
                  aria-pressed={type === t}
                  className={`px-2.5 h-7 text-[12px] font-medium rounded-md border transition-colors ${
                    type === t
                      ? "bg-amber-500/15 border-amber-500/60 text-amber-600 dark:text-amber-400"
                      : "border-border text-muted-foreground hover:text-foreground hover:bg-secondary/60"
                  }`}
                >
                  {t}
                </button>
              ))}
            </div>
          </div>

          <div>
            <p className="text-[10.5px] uppercase tracking-[0.14em] font-semibold text-muted-foreground mb-2">
              Détail
            </p>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={3}
              placeholder="Ex. : 3 colis de fraises écrasés, photo envoyée au fournisseur…"
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-[13px] text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:ring-2 focus:ring-amber-500/40 resize-none"
            />
          </div>

          <div className="flex justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={onClose}>Annuler</Button>
            <Button size="sm" onClick={submit} disabled={saving}>
              {saving && <Loader2 className="animate-spin" />}
              Déclarer l&apos;incident
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────
   Bouton par ligne — ouvre le dialog ; badge = nb d'incidents ouverts.
   ───────────────────────────────────────────────────────────────── */
export function ReceptionIncidentButton({
  receipt, openCount, onChanged,
}: {
  receipt: { docEntry: number; docNum: number; lot?: string; cardCode?: string; cardName?: string };
  openCount: number;
  onChanged: () => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title="Déclarer un incident de réception"
        className={`inline-flex items-center gap-1 px-2 h-6 rounded-md text-[11px] font-semibold border transition-colors ${
          openCount > 0
            ? "bg-amber-500/15 border-amber-500/60 text-amber-600 dark:text-amber-400"
            : "border-border text-muted-foreground hover:text-foreground hover:bg-secondary/60"
        }`}
      >
        <AlertTriangle className="h-3 w-3" />
        {openCount > 0 ? openCount : "Incident"}
      </button>
      {open && (
        <DeclareDialog receipt={receipt} onClose={() => setOpen(false)} onCreated={onChanged} />
      )}
    </>
  );
}

/* ─────────────────────────────────────────────────────────────────
   Panneau incidents ouverts — sous l'historique BR sur /entrees.
   ───────────────────────────────────────────────────────────────── */
export function OpenReceptionIncidents({
  incidents, loading, onChanged,
}: {
  incidents: ReceptionIncident[];
  loading: boolean;
  onChanged: () => void;
}) {
  const open = incidents.filter((i) => !i.resolved);

  async function resolve(id: string) {
    const res = await fetch("/api/entrees/incidents", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, resolved: true }),
    });
    if (res.ok) { toast.success("Incident résolu"); onChanged(); }
    else toast.error("Échec de la résolution");
  }

  if (loading || open.length === 0) return null;

  return (
    <SurfaceCard accent="amber" className="p-5 space-y-3">
      <h2 className="text-[15px] font-semibold flex items-center gap-2">
        <AlertTriangle className="h-4 w-4 text-amber-500" />
        Incidents de réception ouverts
        <span className="text-[12px] font-normal text-muted-foreground">({open.length})</span>
      </h2>
      <ul className="divide-y divide-border/60">
        {open.map((i) => (
          <li key={i.id} className="py-2 flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-baseline gap-2 text-[13px]">
                <span className="font-semibold text-amber-600 dark:text-amber-400">{i.type ?? "Incident"}</span>
                {i.docNum != null && <span className="font-mono text-muted-foreground">BR #{i.docNum}</span>}
                {i.lot && <span className="font-mono text-muted-foreground">{i.lot}</span>}
                {i.cardName && <span className="text-foreground/80 truncate">{i.cardName}</span>}
              </div>
              {i.note && <p className="text-[12px] text-muted-foreground mt-0.5">{i.note}</p>}
              <p className="text-[10.5px] text-muted-foreground/70 mt-0.5">
                {new Date(i.createdAt).toLocaleString("fr-FR", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
                {i.createdBy ? ` · ${i.createdBy}` : ""}
              </p>
            </div>
            <Button variant="ghost" size="sm" onClick={() => resolve(i.id)} title="Marquer résolu">
              <Check className="h-3.5 w-3.5" />
              Résoudre
            </Button>
          </li>
        ))}
      </ul>
    </SurfaceCard>
  );
}

/* ─────────────────────────────────────────────────────────────────
   Hook partagé — charge les incidents et expose un refresh.
   ───────────────────────────────────────────────────────────────── */
export function useReceptionIncidents() {
  const [incidents, setIncidents] = useState<ReceptionIncident[]>([]);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    try {
      const res = await fetch("/api/entrees/incidents", { cache: "no-store" });
      const json = await res.json();
      setIncidents(json.incidents ?? []);
    } catch {
      setIncidents([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { reload(); }, [reload]);

  const openCountByDoc = new Map<number, number>();
  for (const i of incidents) {
    if (i.resolved || i.docEntry == null) continue;
    openCountByDoc.set(i.docEntry, (openCountByDoc.get(i.docEntry) ?? 0) + 1);
  }

  return { incidents, loading, reload, openCountByDoc };
}
