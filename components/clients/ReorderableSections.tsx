"use client";

import { useEffect, useMemo, useState } from "react";
import { GripVertical, Eye, EyeOff, SlidersHorizontal, RotateCcw, Check, Maximize2, Minimize2 } from "lucide-react";

/**
 * Fiche RÉORGANISABLE & pleine largeur.
 *
 * Les blocs se répartissent en mosaïque (1 → 3 colonnes selon la largeur d'écran)
 * pour occuper TOUT l'espace, au lieu d'une colonne étroite. Chaque bloc peut :
 *   • être déplacé (glisser-déposer) pour changer l'ordre ;
 *   • être masqué / affiché (œil) ;
 *   • être renommé (libellé éditable) ;
 *   • passer en pleine largeur ↔ colonne (bouton agrandir / réduire).
 *
 * L'agencement (ordre + masques + libellés + largeurs) est mémorisé par poste
 * (localStorage, clé `storageKey`) et s'applique à toutes les fiches. « Personnaliser »
 * ouvre le mode édition ; « Réinitialiser » restaure la disposition par défaut.
 *
 * Les blocs sont fournis par le serveur (id stable + libellé + nœud rendu) ;
 * `wide` = pleine largeur par défaut (typiquement formulaires / tableaux larges).
 */
export interface FicheSection {
  id: string;
  label: string;
  node: React.ReactNode;
  wide?: boolean;
}

interface Prefs { order: string[]; hidden: string[]; labels?: Record<string, string>; wide?: string[] }

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
  const defaultWide = useMemo(() => sections.filter((s) => s.wide).map((s) => s.id), [sections]);

  const [order, setOrder] = useState<string[]>(defaultOrder);
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [labels, setLabels] = useState<Record<string, string>>({});
  const [wide, setWide] = useState<Set<string>>(new Set(defaultWide));
  const [editing, setEditing] = useState(false);
  const [dragId, setDragId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  // Charge les préférences au montage (client only → pas de mismatch SSR).
  useEffect(() => {
    const p = loadPrefs(storageKey);
    if (p) {
      const known = new Set(defaultOrder);
      const kept = p.order.filter((id) => known.has(id));
      const missing = defaultOrder.filter((id) => !kept.includes(id));
      setOrder([...kept, ...missing]);
      setHidden(new Set(p.hidden.filter((id) => known.has(id))));
      setLabels(p.labels ?? {});
      // largeurs : préférence utilisateur si présente, sinon défauts du serveur.
      setWide(new Set((p.wide ?? defaultWide).filter((id) => known.has(id))));
    }
    setLoaded(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storageKey, defaultOrder.join("|")]);

  const persist = (o: string[], h: Set<string>, l: Record<string, string>, w: Set<string>) => {
    try {
      window.localStorage.setItem(storageKey, JSON.stringify({ order: o, hidden: [...h], labels: l, wide: [...w] }));
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
    persist(next, hidden, labels, wide);
  };

  const toggleHide = (id: string) => {
    const next = new Set(hidden);
    if (next.has(id)) next.delete(id); else next.add(id);
    setHidden(next);
    persist(order, next, labels, wide);
  };

  const toggleWide = (id: string) => {
    const next = new Set(wide);
    if (next.has(id)) next.delete(id); else next.add(id);
    setWide(next);
    persist(order, hidden, labels, next);
  };

  const rename = (id: string, value: string) => {
    const next = { ...labels };
    const def = byId.get(id)?.label ?? "";
    if (!value.trim() || value.trim() === def) delete next[id];
    else next[id] = value.trim();
    setLabels(next);
    persist(order, hidden, next, wide);
  };

  const reset = () => {
    setOrder(defaultOrder);
    setHidden(new Set());
    setLabels({});
    setWide(new Set(defaultWide));
    try { window.localStorage.removeItem(storageKey); } catch { /* ignore */ }
  };

  // Avant chargement : ordre par défaut (évite le flash de réordonnancement).
  const effectiveOrder = loaded ? order : defaultOrder;

  return (
    <div>
      <div className="flex items-center justify-between gap-2 mb-4">
        <p className="text-[12px] text-muted-foreground">
          {editing ? "Glissez les blocs pour réordonner · renommez · masquez (œil) · pleine largeur (⤢)" : ""}
        </p>
        <div className="flex items-center gap-2">
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
      </div>

      {/* Mosaïque : 1 colonne (mobile) → 2 (lg) → 3 (2xl). Les blocs « pleine
          largeur » s'étendent sur toutes les colonnes via column-span. */}
      <div className="gap-5 columns-1 lg:columns-2 2xl:columns-3">
        {effectiveOrder.map((id) => {
          const section = byId.get(id);
          if (!section) return null;
          const isHidden = hidden.has(id);
          if (isHidden && !editing) return null;

          const isWide = wide.has(id);
          const renamed = labels[id] != null && labels[id] !== section.label;
          const spanClass = isWide ? "[column-span:all]" : "";

          if (!editing) {
            return (
              <div key={id} className={`mb-5 break-inside-avoid ${spanClass}`}>
                {renamed && <p className="kicker mb-2 text-brand-600 dark:text-brand-400">{labelOf(id)}</p>}
                {section.node}
              </div>
            );
          }

          // Mode édition : poignée + libellé éditable + largeur + œil.
          return (
            <div
              key={id}
              className={`mb-5 break-inside-avoid ${spanClass}`}
            >
              <div
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
                    type="button" onClick={() => toggleWide(id)}
                    title={isWide ? "Réduire en colonne" : "Pleine largeur"}
                    className="shrink-0 inline-flex items-center justify-center h-8 w-8 rounded-md text-muted-foreground hover:text-foreground hover:bg-secondary/60"
                  >
                    {isWide ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
                  </button>
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
            </div>
          );
        })}
      </div>
    </div>
  );
}
