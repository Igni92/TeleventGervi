"use client";

import { useCallback, useEffect, useState } from "react";
import {
  AlertTriangle, Check, Loader2,
  SearchCheck, PackageMinus, PackageX, Thermometer, Euro, CircleHelp,
  type LucideIcon,
} from "lucide-react";
import { SurfaceCard } from "@/components/ui/surface-card";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { displayPersonName } from "@/lib/userNames";

/**
 * Incidents de réception marchandise (litige fournisseur sur une entrée).
 *
 * - `InlineIncidentDeclare` : bloc de déclaration intégré au DÉTAIL d'une entrée
 *   (type par logo + note). Plus de bouton « + » isolé dans la liste : la
 *   déclaration se fait depuis la consultation du détail.
 * - `OpenReceptionIncidents` : panneau des incidents ouverts (résolution 1 clic).
 * - `useReceptionIncidents` : hook de chargement + comptage par entrée.
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

/* ─────────────────────────────────────────────────────────────────
   Types d'incident — chacun son LOGO (cf. maquette) et sa couleur.
   Qualité · Manquant · Casse · Température · Prix (+ Autre, repli).
   ───────────────────────────────────────────────────────────────── */
export interface IncidentMeta {
  icon: LucideIcon;
  /** Couleur du logo (texte). */
  color: string;
  /** Classes du chip quand le type est sélectionné. */
  active: string;
}

export const INCIDENT_META: Record<string, IncidentMeta> = {
  "Qualité": {
    icon: SearchCheck,
    color: "text-amber-500",
    active: "bg-amber-500/15 border-amber-500/60 text-amber-600 dark:text-amber-400",
  },
  "Manquant": {
    icon: PackageMinus,
    color: "text-blue-500",
    active: "bg-blue-500/15 border-blue-500/60 text-blue-600 dark:text-blue-400",
  },
  "Casse": {
    icon: PackageX,
    color: "text-rose-500",
    active: "bg-rose-500/15 border-rose-500/60 text-rose-600 dark:text-rose-400",
  },
  "Température": {
    icon: Thermometer,
    color: "text-cyan-500",
    active: "bg-cyan-500/15 border-cyan-500/60 text-cyan-600 dark:text-cyan-400",
  },
  "Prix": {
    icon: Euro,
    color: "text-emerald-500",
    active: "bg-emerald-500/15 border-emerald-500/60 text-emerald-600 dark:text-emerald-400",
  },
  "Autre": {
    icon: CircleHelp,
    color: "text-muted-foreground",
    active: "bg-secondary border-border text-foreground",
  },
};

export const INCIDENT_TYPES = Object.keys(INCIDENT_META) as (keyof typeof INCIDENT_META)[];

/** Petit logo coloré d'un type d'incident (repli sur « Autre » si inconnu). */
export function IncidentTypeIcon({ type, className }: { type: string | null; className?: string }) {
  const meta = INCIDENT_META[type ?? ""] ?? INCIDENT_META["Autre"];
  const Icon = meta.icon;
  return <Icon className={className ?? `h-3.5 w-3.5 ${meta.color}`} />;
}

/* ─────────────────────────────────────────────────────────────────
   Déclaration intégrée au détail d'une entrée — logos + note libre.
   ───────────────────────────────────────────────────────────────── */
export function InlineIncidentDeclare({
  receipt, onCreated,
}: {
  receipt: { docEntry: number; docNum: number; lot?: string; cardCode?: string; cardName?: string };
  onCreated: () => void;
}) {
  const [type, setType] = useState<string>("Qualité");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);

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
      toast.success(`Incident « ${type} » déclaré sur l'entrée #${receipt.docNum}`);
      setNote("");
      onCreated();
    } catch (e) {
      toast.error(`Échec de la déclaration : ${e instanceof Error ? e.message : e}`);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="rounded-lg border border-amber-500/30 bg-amber-500/[0.04] p-3 space-y-2.5">
      <p className="text-[10.5px] uppercase tracking-[0.14em] font-semibold text-muted-foreground inline-flex items-center gap-1.5">
        <AlertTriangle className="h-3 w-3 text-amber-500" />
        Déclarer un incident
      </p>
      <div className="flex flex-wrap gap-1.5">
        {INCIDENT_TYPES.map((t) => {
          const meta = INCIDENT_META[t];
          const Icon = meta.icon;
          const on = type === t;
          return (
            <button
              key={t}
              type="button"
              onClick={() => setType(t)}
              aria-pressed={on}
              className={`inline-flex items-center gap-1.5 px-2.5 h-8 text-[12px] font-medium rounded-md border transition-colors ${
                on ? meta.active : "border-border text-muted-foreground hover:text-foreground hover:bg-secondary/60"
              }`}
            >
              <Icon className={`h-3.5 w-3.5 ${on ? "" : meta.color}`} />
              {t}
            </button>
          );
        })}
      </div>
      <div className="flex items-center gap-2">
        <input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Détail (ex. 3 colis écrasés, photo envoyée au fournisseur)…"
          className="flex-1 h-8 rounded-md border border-border bg-background px-2.5 text-[12.5px] text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:ring-2 focus:ring-amber-500/40"
        />
        <Button size="sm" onClick={submit} disabled={saving}>
          {saving && <Loader2 className="animate-spin" />}
          Déclarer
        </Button>
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────
   Panneau incidents ouverts — sous la liste des entrées sur /entrees.
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
                <span className="inline-flex items-center gap-1 font-semibold text-foreground">
                  <IncidentTypeIcon type={i.type} className="h-3.5 w-3.5 self-center" />
                  {i.type ?? "Incident"}
                </span>
                {i.docNum != null && <span className="font-mono text-muted-foreground">EM #{i.docNum}</span>}
                {i.lot && <span className="font-mono text-muted-foreground">{i.lot}</span>}
                {i.cardCode && <span className="font-mono text-foreground/80 truncate">{i.cardCode}</span>}
              </div>
              {i.note && <p className="text-[12px] text-muted-foreground mt-0.5">{i.note}</p>}
              <p className="text-[10.5px] text-muted-foreground/70 mt-0.5">
                {new Date(i.createdAt).toLocaleString("fr-FR", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
                {i.createdBy ? ` · ${displayPersonName(i.createdBy)}` : ""}
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

  /** Incidents (ouverts + résolus) regroupés par entrée. */
  const byDoc = new Map<number, ReceptionIncident[]>();
  for (const i of incidents) {
    if (i.docEntry == null) continue;
    const arr = byDoc.get(i.docEntry) ?? [];
    arr.push(i);
    byDoc.set(i.docEntry, arr);
  }

  return { incidents, loading, reload, openCountByDoc, byDoc };
}
