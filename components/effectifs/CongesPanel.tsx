"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Palmtree, Send, Check, X, Loader2, CalendarClock } from "lucide-react";
import { SurfaceCard } from "@/components/ui/surface-card";
import { displayPersonName } from "@/lib/userNames";
import {
  CONGE_TYPE_LABEL, CONGE_STATUS_LABEL, congeDayCount, validateConge,
  type CongeType, type CongeStatus,
} from "@/lib/conges";

/**
 * CONGÉS — demande salarié + validation DIRECTION, sur la page « Mes heures ».
 * Le salarié pose une demande (type + plage) ; la direction valide/refuse (push +
 * in-app). Chaque partie ne voit que ce qui la concerne (rôle renvoyé par l'API).
 */

interface Conge {
  id: string; email: string; name: string; type: CongeType;
  start: string; end: string; note: string; status: CongeStatus;
  createdAt: string; decidedBy?: string; decisionNote?: string;
}
interface Data { ok: boolean; isDirection: boolean; mine: Conge[]; all?: Conge[]; pending?: number }

const TYPES: CongeType[] = ["cp", "rtt", "recup", "sans_solde", "maladie", "autre"];
const fmt = (iso: string) => (iso ? new Date(`${iso}T12:00:00Z`).toLocaleDateString("fr-FR", { timeZone: "UTC", day: "2-digit", month: "2-digit", year: "2-digit" }) : "—");
const rangeLabel = (c: { start: string; end: string }) => (c.start === c.end ? fmt(c.start) : `${fmt(c.start)} → ${fmt(c.end)}`);

const STATUS_TONE: Record<CongeStatus, string> = {
  pending: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
  approved: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
  refused: "bg-rose-500/15 text-rose-700 dark:text-rose-300",
  cancelled: "bg-secondary text-muted-foreground",
};

export function CongesPanel() {
  const [data, setData] = useState<Data | null>(null);
  const [busy, setBusy] = useState(false);
  const [type, setType] = useState<CongeType>("cp");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [note, setNote] = useState("");

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/effectif/conges", { cache: "no-store" });
      const j = (await r.json().catch(() => null)) as Data | null;
      if (j?.ok) setData(j);
    } catch { /* silencieux */ }
  }, []);
  useEffect(() => { load(); }, [load]);

  const post = async (payload: Record<string, unknown>): Promise<boolean> => {
    setBusy(true);
    try {
      const r = await fetch("/api/effectif/conges", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload),
      });
      const j = await r.json().catch(() => null);
      if (!r.ok || !j?.ok) { toast.error(j?.error || "Action impossible"); return false; }
      return true;
    } catch { toast.error("Action impossible — réseau ?"); return false; }
    finally { setBusy(false); }
  };

  const days = useMemo(() => (start && end ? congeDayCount(start, end) : null), [start, end]);

  const submit = async () => {
    const err = validateConge({ type, start, end });
    if (err) { toast.error(err); return; }
    if (await post({ action: "request", type, start, end, note })) {
      toast.success("Demande de congés envoyée à la direction.");
      setStart(""); setEnd(""); setNote(""); await load();
    }
  };
  const cancel = async (id: string) => {
    if (await post({ action: "cancel", id })) { toast.success("Demande annulée."); await load(); }
  };
  const decide = async (c: Conge, decision: "approved" | "refused") => {
    if (await post({ action: "decide", id: c.id, email: c.email, decision })) {
      toast.success(decision === "approved" ? "Congés validés." : "Congés refusés."); await load();
    }
  };

  if (!data) return null;
  const pending = (data.all ?? []).filter((c) => c.status === "pending");

  return (
    <div className="space-y-4">
      {/* ── Direction : demandes à valider ── */}
      {data.isDirection && (
        <SurfaceCard accent="violet" title={`Congés à valider${pending.length ? ` · ${pending.length}` : ""}`} icon={<CalendarClock className="h-3.5 w-3.5" />}>
          {pending.length === 0 ? (
            <p className="py-2 text-[13px] italic text-muted-foreground">Aucune demande en attente.</p>
          ) : (
            <ul className="space-y-2">
              {pending.map((c) => (
                <li key={c.id} className="rounded-lg border border-border bg-secondary/20 p-3">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span className="text-[13px] font-semibold text-foreground">{displayPersonName(c.name)}</span>
                    <span className="rounded-md bg-violet-500/15 px-1.5 py-0.5 text-[11px] font-semibold text-violet-700 dark:text-violet-300">{CONGE_TYPE_LABEL[c.type]}</span>
                    <span className="text-[12.5px] tnum text-foreground">{rangeLabel(c)}</span>
                    {congeDayCount(c.start, c.end) && <span className="text-[11.5px] text-muted-foreground tnum">{congeDayCount(c.start, c.end)} j</span>}
                  </div>
                  {c.note && <p className="mt-1 text-[12px] text-muted-foreground">« {c.note} »</p>}
                  <div className="mt-2 flex gap-2">
                    <button type="button" onClick={() => decide(c, "approved")} disabled={busy}
                      className="inline-flex items-center gap-1 h-8 px-3 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-[12.5px] font-semibold disabled:opacity-50">
                      <Check className="h-3.5 w-3.5" /> Valider
                    </button>
                    <button type="button" onClick={() => decide(c, "refused")} disabled={busy}
                      className="inline-flex items-center gap-1 h-8 px-3 rounded-lg border border-border text-[12.5px] font-semibold text-muted-foreground hover:text-foreground hover:bg-secondary/60 disabled:opacity-50">
                      <X className="h-3.5 w-3.5" /> Refuser
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </SurfaceCard>
      )}

      {/* ── Salarié : poser une demande + suivi ── */}
      <SurfaceCard accent="emerald" title="Mes congés" icon={<Palmtree className="h-3.5 w-3.5" />}>
        <div className="rounded-lg border border-border bg-secondary/20 p-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
            <div>
              <label className="block text-[10px] uppercase tracking-wide font-semibold text-muted-foreground mb-1">Type</label>
              <select value={type} onChange={(e) => setType(e.target.value as CongeType)}
                className="h-9 w-full rounded-md border border-border bg-background px-2 text-[13px] focus:outline-none focus:ring-1 focus:ring-brand-500">
                {TYPES.map((t) => <option key={t} value={t}>{CONGE_TYPE_LABEL[t]}</option>)}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-[10px] uppercase tracking-wide font-semibold text-muted-foreground mb-1">Du</label>
                <input type="date" value={start} onChange={(e) => setStart(e.target.value)}
                  className="h-9 w-full rounded-md border border-border bg-background px-2 text-[13px] tnum focus:outline-none focus:ring-1 focus:ring-brand-500" />
              </div>
              <div>
                <label className="block text-[10px] uppercase tracking-wide font-semibold text-muted-foreground mb-1">Au</label>
                <input type="date" value={end} min={start || undefined} onChange={(e) => setEnd(e.target.value)}
                  className="h-9 w-full rounded-md border border-border bg-background px-2 text-[13px] tnum focus:outline-none focus:ring-1 focus:ring-brand-500" />
              </div>
            </div>
          </div>
          <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} placeholder="Motif / précision (facultatif)"
            className="mt-2.5 h-9 w-full rounded-md border border-border bg-background px-2.5 text-[13px] focus:outline-none focus:ring-1 focus:ring-brand-500" />
          <div className="mt-2.5 flex items-center gap-2">
            <button type="button" onClick={submit} disabled={busy || !start || !end}
              className="inline-flex items-center gap-1.5 h-10 px-4 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-[13px] font-semibold disabled:opacity-50">
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />} Demander
            </button>
            {days != null && days > 0 && <span className="text-[12px] text-muted-foreground tnum">{days} jour{days > 1 ? "s" : ""}</span>}
          </div>
        </div>

        {data.mine.length > 0 && (
          <ul className="mt-3 space-y-1.5">
            {data.mine.filter((c) => c.status !== "cancelled").map((c) => (
              <li key={c.id} className="flex items-center gap-2 rounded-lg border border-border px-3 py-2">
                <span className="rounded-md bg-secondary px-1.5 py-0.5 text-[11px] font-semibold text-muted-foreground shrink-0">{CONGE_TYPE_LABEL[c.type]}</span>
                <span className="min-w-0 flex-1 text-[12.5px] tnum text-foreground truncate">{rangeLabel(c)}</span>
                <span className={`shrink-0 rounded-md px-1.5 py-0.5 text-[10.5px] font-semibold ${STATUS_TONE[c.status]}`}>{CONGE_STATUS_LABEL[c.status]}</span>
                {c.status === "pending" && (
                  <button type="button" onClick={() => cancel(c.id)} disabled={busy} title="Annuler"
                    className="shrink-0 inline-flex h-7 w-7 items-center justify-center rounded-md border border-border text-muted-foreground hover:text-foreground hover:bg-secondary/60">
                    <X className="h-3.5 w-3.5" />
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </SurfaceCard>
    </div>
  );
}
