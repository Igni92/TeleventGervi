"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import {
  Loader2, Search, ChevronRight, ChevronLeft, ArrowLeftRight,
  CalendarClock, CheckSquare, Square, RotateCcw, Store, Building2, Globe,
} from "lucide-react";

type Side = "A" | "B";

interface Client {
  id: string;
  code: string;
  nom: string;
  type: string | null;
  city: string | null;
  activeTelevente: boolean;
  vendeur: string | null;
  baseline: string | null;
  reassign: { to: string; from: string; endDate: string; by: string } | null;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Vendeur A = la carte cliquée. */
  aTrig: string;
  aName: string;
  /** Vendeur B = moi (l'utilisateur connecté). */
  bTrig: string;
  bName: string;
}

const TYPE_ICON: Record<string, typeof Store> = { CHR: Store, GMS: Building2, EXPORT: Globe };

function firstName(name: string): string {
  return (name.split(/\s+[-–]\s+/)[0].trim() || name).split(/\s+/)[0];
}

export function TransferClientsDialog({ open, onOpenChange, aTrig, aName, bTrig, bName }: Props) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [clients, setClients] = useState<Client[]>([]);
  // Colonne où chaque client se trouve APRÈS édition (staging local, non persisté).
  const [col, setCol] = useState<Map<string, Side>>(new Map());
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [queryA, setQueryA] = useState("");
  const [queryB, setQueryB] = useState("");
  const [endDate, setEndDate] = useState("");
  const [saving, setSaving] = useState(false);
  const [dragOver, setDragOver] = useState<Side | null>(null);

  const initialCol = useCallback((c: Client): Side => (c.vendeur === aTrig ? "A" : "B"), [aTrig]);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const res = await fetch(`/api/vendeur-reassign?a=${encodeURIComponent(aTrig)}&b=${encodeURIComponent(bTrig)}`);
      const j = await res.json();
      if (!res.ok) throw new Error(j?.error || "Chargement impossible");
      const list: Client[] = j.clients ?? [];
      setClients(list);
      setCol(new Map(list.map((c) => [c.id, c.vendeur === aTrig ? "A" : "B"])));
      setSelected(new Set());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur");
    } finally {
      setLoading(false);
    }
  }, [aTrig, bTrig]);

  useEffect(() => {
    if (open) { setQueryA(""); setQueryB(""); setEndDate(""); load(); }
  }, [open, load]);

  const trigName = useCallback((t: string | null): string => {
    if (t === aTrig) return firstName(aName);
    if (t === bTrig) return firstName(bName);
    return t ?? "?";
  }, [aTrig, bTrig, aName, bName]);

  // Répartition courante (staging) par colonne + filtre recherche.
  const byCol = useMemo(() => {
    const A: Client[] = []; const B: Client[] = [];
    for (const c of clients) ((col.get(c.id) ?? initialCol(c)) === "A" ? A : B).push(c);
    const filt = (arr: Client[], q: string) => {
      const s = q.trim().toLowerCase();
      if (!s) return arr;
      return arr.filter((c) => c.nom.toLowerCase().includes(s) || c.code.toLowerCase().includes(s) || (c.city ?? "").toLowerCase().includes(s));
    };
    return { A: filt(A, queryA), B: filt(B, queryB), countA: A.length, countB: B.length };
  }, [clients, col, initialCol, queryA, queryB]);

  // Diff vs état serveur.
  const diff = useMemo(() => {
    const toA: string[] = []; const toB: string[] = [];
    let needDate = false;
    for (const c of clients) {
      const now = col.get(c.id) ?? initialCol(c);
      if (now === initialCol(c)) continue; // inchangé
      if (now === "A") { toA.push(c.id); if (c.baseline !== aTrig) needDate = true; }
      else { toB.push(c.id); if (c.baseline !== bTrig) needDate = true; }
    }
    return { toA, toB, needDate, total: toA.length + toB.length };
  }, [clients, col, initialCol, aTrig, bTrig]);

  const move = useCallback((ids: string[], to: Side) => {
    if (ids.length === 0) return;
    setCol((prev) => { const next = new Map(prev); for (const id of ids) next.set(id, to); return next; });
    setSelected((prev) => { const next = new Set(prev); for (const id of ids) next.delete(id); return next; });
  }, []);

  const toggleSel = useCallback((id: string) => {
    setSelected((prev) => { const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  }, []);

  const selectedIn = useCallback((side: Side) => {
    const list = side === "A" ? byCol.A : byCol.B;
    return list.filter((c) => selected.has(c.id)).map((c) => c.id);
  }, [byCol, selected]);

  const save = useCallback(async () => {
    if (diff.total === 0) { onOpenChange(false); return; }
    if (diff.needDate && !endDate) {
      toast.error("Choisis une date de retour", { description: "Elle définit quand les clients basculés reviennent à leur titulaire." });
      return;
    }
    setSaving(true);
    try {
      const calls: Promise<Response>[] = [];
      if (diff.toB.length) calls.push(fetch("/api/vendeur-reassign", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ids: diff.toB, to: bTrig, endDate: endDate || null }) }));
      if (diff.toA.length) calls.push(fetch("/api/vendeur-reassign", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ids: diff.toA, to: aTrig, endDate: endDate || null }) }));
      const results = await Promise.all(calls);
      let moved = 0, reverted = 0;
      for (const r of results) {
        const j = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(j?.error || "Échec de la bascule");
        moved += j.moved ?? 0; reverted += j.reverted ?? 0;
      }
      const parts: string[] = [];
      if (moved) parts.push(`${moved} basculé${moved > 1 ? "s" : ""}`);
      if (reverted) parts.push(`${reverted} rendu${reverted > 1 ? "s" : ""}`);
      toast.success(parts.join(" · ") || "Enregistré", {
        description: endDate && moved ? `Retour automatique le ${new Date(endDate + "T00:00:00").toLocaleDateString("fr-FR")}` : undefined,
      });
      onOpenChange(false);
      router.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Échec de l'enregistrement");
    } finally {
      setSaving(false);
    }
  }, [diff, endDate, aTrig, bTrig, onOpenChange, router]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ArrowLeftRight className="h-4 w-4 text-brand-600" />
            Transférer des clients
          </DialogTitle>
          <DialogDescription>
            Portefeuille <span className="font-medium text-foreground">vendeur (télévente)</span> — bascule temporaire
            entre <span className="font-medium text-foreground">{firstName(aName)}</span> et{" "}
            <span className="font-medium text-foreground">{firstName(bName)}</span>. Coche, glisse ou utilise les
            flèches, puis choisis une date de retour.
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center justify-center py-16 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" />
          </div>
        ) : error ? (
          <div className="py-10 text-center">
            <p className="text-sm text-rose-600">{error}</p>
            <button onClick={load} className="mt-3 text-xs font-medium text-brand-600 hover:underline">Réessayer</button>
          </div>
        ) : (
          <div className="grid gap-3 md:grid-cols-[1fr_auto_1fr] items-stretch">
            <Column
              side="A" title={firstName(aName)} trig={aTrig} count={byCol.countA}
              clients={byCol.A} selected={selected} query={queryA} onQuery={setQueryA}
              onToggle={toggleSel} onMoveOne={(id) => move([id], "B")} moveDir="right"
              onSelectAll={() => setSelected((p) => { const n = new Set(p); byCol.A.forEach((c) => n.add(c.id)); return n; })}
              onClearSel={() => setSelected((p) => { const n = new Set(p); byCol.A.forEach((c) => n.delete(c.id)); return n; })}
              dragOver={dragOver === "A"}
              onDragEnter={() => setDragOver("A")} onDragLeaveCol={() => setDragOver((d) => (d === "A" ? null : d))}
              onDrop={() => { const ids = selectedIn("B"); move(ids.length ? ids : Array.from(draggingRef), "A"); setDragOver(null); }}
              trigName={trigName} homeTrig={aTrig}
            />

            {/* Colonne centrale : flèches de déplacement en masse (desktop). */}
            <div className="hidden md:flex flex-col items-center justify-center gap-2 px-1">
              <MoveBtn dir="right" n={selectedIn("A").length} onClick={() => move(selectedIn("A"), "B")} />
              <MoveBtn dir="left" n={selectedIn("B").length} onClick={() => move(selectedIn("B"), "A")} />
            </div>

            <Column
              side="B" title={firstName(bName)} trig={bTrig} count={byCol.countB}
              clients={byCol.B} selected={selected} query={queryB} onQuery={setQueryB}
              onToggle={toggleSel} onMoveOne={(id) => move([id], "A")} moveDir="left"
              onSelectAll={() => setSelected((p) => { const n = new Set(p); byCol.B.forEach((c) => n.add(c.id)); return n; })}
              onClearSel={() => setSelected((p) => { const n = new Set(p); byCol.B.forEach((c) => n.delete(c.id)); return n; })}
              dragOver={dragOver === "B"}
              onDragEnter={() => setDragOver("B")} onDragLeaveCol={() => setDragOver((d) => (d === "B" ? null : d))}
              onDrop={() => { const ids = selectedIn("A"); move(ids.length ? ids : Array.from(draggingRef), "B"); setDragOver(null); }}
              trigName={trigName} homeTrig={aTrig}
            />

            {/* Flèches mobile (sous les listes). */}
            <div className="flex md:hidden items-center justify-center gap-3 pt-1">
              <MoveBtn dir="left" n={selectedIn("B").length} onClick={() => move(selectedIn("B"), "A")} wide />
              <MoveBtn dir="right" n={selectedIn("A").length} onClick={() => move(selectedIn("A"), "B")} wide />
            </div>
          </div>
        )}

        {/* Pied : date de retour + résumé + valider. */}
        {!loading && !error && (
          <div className="mt-1 space-y-3 border-t border-border pt-3">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
              <label className={`inline-flex items-center gap-2 text-[13px] ${diff.needDate ? "text-foreground" : "text-muted-foreground"}`}>
                <CalendarClock className="h-4 w-4" />
                <span className="font-medium">Date de retour</span>
                <input
                  type="date"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  className={`h-8 rounded-md border bg-background px-2 text-[13px] tnum focus:outline-none focus:ring-2 focus:ring-brand-500 ${diff.needDate && !endDate ? "border-amber-400" : "border-border"}`}
                />
              </label>
              {diff.needDate && (
                <span className="text-[11.5px] text-muted-foreground">
                  Les clients basculés reviennent à leur titulaire ce jour-là.
                </span>
              )}
            </div>

            <div className="flex items-center justify-between gap-3">
              <p className="text-[12px] text-muted-foreground">
                {diff.total === 0
                  ? "Aucun changement."
                  : `${diff.total} changement${diff.total > 1 ? "s" : ""} : `}
                {diff.toB.length > 0 && <span className="text-foreground">{diff.toB.length} → {firstName(bName)} </span>}
                {diff.toA.length > 0 && <span className="text-foreground">{diff.toA.length} → {firstName(aName)}</span>}
              </p>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => onOpenChange(false)}
                  className="h-9 px-3 rounded-lg text-[13px] font-medium text-muted-foreground hover:bg-secondary/60 transition-colors"
                >
                  Annuler
                </button>
                <button
                  type="button"
                  onClick={save}
                  disabled={saving || diff.total === 0}
                  className="h-9 px-4 rounded-lg text-[13px] font-semibold bg-brand-600 hover:bg-brand-700 text-white transition-colors active:scale-[0.98] disabled:opacity-50 inline-flex items-center gap-2"
                >
                  {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowLeftRight className="h-4 w-4" />}
                  Enregistrer
                </button>
              </div>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

// Référence de la ligne en cours de glissement (drag d'une ligne non sélectionnée).
const draggingRef = new Set<string>();

function Column(props: {
  side: Side; title: string; trig: string; count: number;
  clients: Client[]; selected: Set<string>; query: string; onQuery: (v: string) => void;
  onToggle: (id: string) => void; onMoveOne: (id: string) => void; moveDir: "left" | "right";
  onSelectAll: () => void; onClearSel: () => void;
  dragOver: boolean; onDragEnter: () => void; onDragLeaveCol: () => void; onDrop: () => void;
  trigName: (t: string | null) => string; homeTrig: string;
}) {
  const { clients, selected, query, moveDir } = props;
  const selCount = clients.filter((c) => selected.has(c.id)).length;
  const allSel = clients.length > 0 && selCount === clients.length;
  return (
    <div
      onDragOver={(e) => { e.preventDefault(); props.onDragEnter(); }}
      onDragLeave={props.onDragLeaveCol}
      onDrop={(e) => { e.preventDefault(); props.onDrop(); }}
      className={`flex flex-col rounded-xl border bg-card min-h-[280px] transition-colors ${props.dragOver ? "border-brand-500 ring-2 ring-brand-500/30" : "border-border"}`}
    >
      <div className="flex items-center justify-between gap-2 px-3 pt-3">
        <div className="flex items-center gap-2 min-w-0">
          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-brand-600 text-white text-[10px] font-bold">{props.trig}</span>
          <p className="font-semibold text-[13.5px] text-foreground truncate">{props.title}</p>
          <span className="text-[11.5px] text-muted-foreground tnum">{props.count}</span>
        </div>
        <button
          type="button"
          onClick={allSel ? props.onClearSel : props.onSelectAll}
          disabled={clients.length === 0}
          className="inline-flex items-center gap-1 text-[11px] font-medium text-muted-foreground hover:text-foreground disabled:opacity-40"
        >
          {allSel ? <CheckSquare className="h-3.5 w-3.5" /> : <Square className="h-3.5 w-3.5" />}
          Tout
        </button>
      </div>

      <div className="px-3 pt-2">
        <div className="relative">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <input
            value={query}
            onChange={(e) => props.onQuery(e.target.value)}
            placeholder="Rechercher…"
            className="w-full h-8 rounded-md border border-border bg-background pl-7 pr-2 text-[12.5px] focus:outline-none focus:ring-2 focus:ring-brand-500"
          />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-2 space-y-1 max-h-[46vh]">
        {clients.length === 0 ? (
          <p className="text-center text-[12px] text-muted-foreground py-8">Aucun client</p>
        ) : (
          clients.map((c) => {
            const isSel = selected.has(c.id);
            const TypeIcon = c.type ? TYPE_ICON[c.type] : undefined;
            // Client actuellement « invité » (basculé depuis un autre titulaire).
            const guest = c.reassign && c.baseline !== props.trig;
            return (
              <div
                key={c.id}
                draggable
                onDragStart={() => { if (!selected.has(c.id)) { draggingRef.clear(); draggingRef.add(c.id); } else { draggingRef.clear(); selected.forEach((id) => draggingRef.add(id)); } }}
                onClick={() => props.onToggle(c.id)}
                className={`group flex items-center gap-2 rounded-lg border px-2 py-1.5 cursor-pointer select-none transition-colors ${isSel ? "border-brand-500 bg-brand-500/10" : "border-transparent hover:bg-secondary/60"}`}
              >
                <span className={`grid h-4 w-4 shrink-0 place-items-center rounded border ${isSel ? "border-brand-600 bg-brand-600 text-white" : "border-border bg-background"}`}>
                  {isSel && <CheckSquare className="h-3 w-3" strokeWidth={3} />}
                </span>
                {moveDir === "left" && (
                  <button type="button" onClick={(e) => { e.stopPropagation(); props.onMoveOne(c.id); }} title="Déplacer à gauche" className="shrink-0 text-muted-foreground hover:text-brand-600">
                    <ChevronLeft className="h-4 w-4" />
                  </button>
                )}
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <p className="truncate text-[12.5px] font-medium text-foreground">{c.nom}</p>
                    {!c.activeTelevente && <span className="shrink-0 text-[9px] uppercase tracking-wide text-muted-foreground">inactif</span>}
                  </div>
                  <div className="flex items-center gap-1.5 text-[10.5px] text-muted-foreground">
                    <span className="tnum">{c.code}</span>
                    {TypeIcon && <TypeIcon className="h-3 w-3" />}
                    {c.city && <span className="truncate">· {c.city}</span>}
                    {guest && (
                      <span className="inline-flex items-center gap-0.5 rounded bg-amber-100 dark:bg-amber-900/30 px-1 text-amber-700 dark:text-amber-300" title={`Titulaire : ${props.trigName(c.baseline)} — retour le ${c.reassign ? new Date(c.reassign.endDate + "T00:00:00").toLocaleDateString("fr-FR") : ""}`}>
                        <RotateCcw className="h-2.5 w-2.5" /> {props.trigName(c.baseline)}
                      </span>
                    )}
                  </div>
                </div>
                {moveDir === "right" && (
                  <button type="button" onClick={(e) => { e.stopPropagation(); props.onMoveOne(c.id); }} title="Déplacer à droite" className="shrink-0 text-muted-foreground hover:text-brand-600">
                    <ChevronRight className="h-4 w-4" />
                  </button>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

function MoveBtn({ dir, n, onClick, wide }: { dir: "left" | "right"; n: number; onClick: () => void; wide?: boolean }) {
  const Icon = dir === "right" ? ChevronRight : ChevronLeft;
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={n === 0}
      title={n === 0 ? "Sélectionne des clients" : `Déplacer ${n} client(s)`}
      className={`inline-flex items-center justify-center gap-1 rounded-lg border border-border bg-background text-muted-foreground hover:text-brand-600 hover:border-brand-500 transition-colors disabled:opacity-40 ${wide ? "h-9 flex-1 px-3" : "h-9 w-9"}`}
    >
      {dir === "left" && <Icon className="h-4 w-4" />}
      {n > 0 && <span className="text-[12px] font-semibold tnum">{n}</span>}
      {dir === "right" && <Icon className="h-4 w-4" />}
    </button>
  );
}
