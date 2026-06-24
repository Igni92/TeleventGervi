"use client";

import { useEffect, useMemo, useState } from "react";
import { GripVertical, Eye, EyeOff, SlidersHorizontal, RotateCcw, Check } from "lucide-react";

/**
 * Sections de fiche RÉORGANISABLES — glisser-déposer pour changer l'ordre,
 * œil pour masquer/afficher. L'agencement est mémorisé (localStorage) par
 * `storageKey` (donc par utilisateur/poste). Bouton « Personnaliser » pour
 * entrer/sortir du mode édition ; « Réinitialiser » pour revenir au défaut.
 *
 * Les blocs sont fournis par le serveur (id stable + libellé + nœud rendu).
 */
export interface FicheSection {
  id: string;
  label: string;
  node: React.ReactNode;
}

interface Prefs { order: string[]; hidden: string[]; labels?: Record<string, string> }

function loadPrefs(key: string): Prefs | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;
    const p = JSON.parse(raw);
    if (Array.isArray(p.order) && Array.isArray(p.hidden)) return p;
  } catch { /* ignore */ }
  return null;
}

export function ReorderableSections({ storageKey, sections }: { storageKey: string; sections: FicheSection[] }) {
  const defaultOrder = useMemo(() => sections.map((s) => s.id), [sections]);
  const [order, setOrder] = useState<string[]>(defaultOrder);
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [labels, setLabels] = useState<Record<string, string>>({});
  const [editing, setEditing] = useState(false);
  const [dragId, setDragId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  // Charge les préférences au montage (client only → pas de mismatch SSR).
  useEffect(() => {
    const p = loadPrefs(storageKey);
    if (p) {
      // Fusionne : on garde l'ordre sauvé, on ajoute les nouveaux blocs à la fin,
      // on retire les blocs disparus.
      const known = new Set(defaultOrder);
      const kept = p.order.filter((id) => known.has(id));
      const missing = defaultOrder.filter((id) => !kept.includes(id));
      setOrder([...kept, ...missing]);
      setHidden(new Set(p.hidden.filter((id) => known.has(id))));
      setLabels(p.labels ?? {});
    }
    setLoaded(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storageKey, defaultOrder.join("|")]);

  const persist = (nextOrder: string[], nextHidden: Set<string>, nextLabels: Record<string, string>) => {
    try {
      window.localStorage.setItem(storageKey, JSON.stringify({ order: nextOrder, hidden: [...nextHidden], labels: nextLabels }));
    } catch { /* quota — non bloquant */ }
  };

  const byId = useMemo(() => new Map(sections.map((s) => [s.id, s])), [sections]);
  const labelOf = (id: string) => (labels[id] ?? byId.get(id)?.label ?? "");

  const move = (from: string, to: string) => {
    if (from === to) return;
    const next = [...order];
    const fi = next.indexOf(from);
    const ti = next.indexOf(to);
    if (fi < 0 || ti < 0) return;
    next.splice(fi, 1);
    next.splice(next.indexOf(to) + (fi < ti ? 1 : 0), 0, from);
    setOrder(next);
    persist(next, hidden, labels);
  };

  const toggleHide = (id: string) => {
    const next = new Set(hidden);
    if (next.has(id)) next.delete(id); else next.add(id);
    setHidden(next);
    persist(order, next, labels);
  };

  const rename = (id: string, value: string) => {
    const next = { ...labels };
    const def = byId.get(id)?.label ?? "";
    if (!value.trim() || value.trim() === def) delete next[id];
    else next[id] = value.trim();
    setLabels(next);
    persist(order, hidden, next);
  };

  const reset = () => {
    setOrder(defaultOrder);
    setHidden(new Set());
    setLabels({});
    try { window.localStorage.removeItem(storageKey); } catch { /* ignore */ }
  };

  // Avant chargement : rendu par défaut (évite le flash de réordonnancement).
  const effectiveOrder = loaded ? order : defaultOrder;

  return (
    <div className="space-y-5 sm:space-y-6">
      <div className="flex items-center justify-end gap-2">
        {editing && (
          <button
            type="button" onClick={reset}
            className="inline-flex items-center gap-1.5 h-8 px-2.5 rounded-md text-[12px] font-medium text-muted-foreground hover:text-foreground hover:bg-secondary/60 transition-colors"
          >
            <RotateCcw className="h-3.5 w-3.5" /> Réinitialiser
          </button>
        )}
        <button
          type="button" onClick={() => setEditing((e) => !e)}
          className={`inline-flex items-center gap-1.5 h-8 px-3 rounded-md text-[12px] font-semibold transition-colors ${
            editing
              ? "bg-brand-600 text-white hover:bg-brand-700"
              : "border border-border text-muted-foreground hover:text-foreground hover:bg-secondary/60"
          }`}
        >
          {editing ? <><Check className="h-3.5 w-3.5" /> Terminer</> : <><SlidersHorizontal className="h-3.5 w-3.5" /> Personnaliser</>}
        </button>
      </div>

      {effectiveOrder.map((id) => {
        const section = byId.get(id);
        if (!section) return null;
        const isHidden = hidden.has(id);
        if (isHidden && !editing) return null;

        const renamed = labels[id] != null && labels[id] !== section.label;

        if (!editing) {
          return (
            <div key={id}>
              {/* Libellé personnalisé (affiché uniquement s'il a été renommé) */}
              {renamed && (
                <p className="kicker mb-2 text-brand-600 dark:text-brand-400">{labelOf(id)}</p>
              )}
              {section.node}
            </div>
          );
        }

        // Mode édition : poignée de drag + libellé éditable + œil + nœud (grisé si masqué).
        return (
          <div
            key={id}
            draggable
            onDragStart={() => setDragId(id)}
            onDragEnd={() => { setDragId(null); setOverId(null); }}
            onDragOver={(e) => { e.preventDefault(); if (overId !== id) setOverId(id); }}
            onDrop={(e) => { e.preventDefault(); if (dragId) move(dragId, id); setOverId(null); }}
            className={`relative rounded-xl transition-all ${dragId === id ? "opacity-40" : ""} ${overId === id && dragId !== id ? "ring-2 ring-brand-500 ring-offset-2 ring-offset-background" : ""}`}
          >
            <div className="flex items-center gap-2 mb-2 px-1">
              <GripVertical className="h-4 w-4 shrink-0 text-muted-foreground cursor-grab active:cursor-grabbing" />
              <input
                value={labelOf(id)}
                onChange={(e) => rename(id, e.target.value)}
                onDragStart={(e) => e.preventDefault()}
                draggable={false}
                aria-label={`Renommer ${section.label}`}
                className="flex-1 min-w-0 h-8 px-2 rounded-md border border-border bg-background text-[13px] font-semibold text-foreground focus:outline-none focus:ring-2 focus:ring-brand-500"
              />
              <button
                type="button" onClick={() => toggleHide(id)}
                title={isHidden ? "Afficher" : "Masquer"}
                className="shrink-0 inline-flex items-center justify-center h-8 w-8 rounded-md text-muted-foreground hover:text-foreground hover:bg-secondary/60"
              >
                {isHidden ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
            <div className={isHidden ? "opacity-40 pointer-events-none" : ""}>{section.node}</div>
          </div>
        );
      })}
    </div>
  );
}
