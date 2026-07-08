"use client";

import { useEffect, useMemo, useState } from "react";
import { GripVertical, Eye, EyeOff, SlidersHorizontal, RotateCcw, Check, Maximize2, Minimize2, Pencil, ArrowDownToLine } from "lucide-react";

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
  // Libellé en cours d'édition (crayon) — sinon la carte entière glisse au lieu
  // d'éditer le texte ; on ne rend le champ modifiable qu'après un clic crayon.
  const [editId, setEditId] = useState<string | null>(null);
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

  // INSÉRER `from` avant `before` (ou en fin si `before` = null) — geste
  // « entre deux blocs ». ÉCHANGER deux blocs — geste « déposer sur un bloc ».
  const moveBefore = (from: string, before: string | null) => {
    if (from === before) return;
    const next = order.filter((x) => x !== from);
    if (next.length === order.length) return; // `from` inconnu
    const at = before ? next.indexOf(before) : -1;
    next.splice(at < 0 ? next.length : at, 0, from);
    setOrder(next);
    persist(next, hidden, labels, wide);
  };
  const swap = (a: string, b: string) => {
    if (a === b) return;
    const next = [...order];
    const ai = next.indexOf(a), bi = next.indexOf(b);
    if (ai < 0 || bi < 0) return;
    [next[ai], next[bi]] = [next[bi], next[ai]];
    setOrder(next);
    persist(next, hidden, labels, wide);
  };
  // Fin d'un glisser : réordonne selon la zone survolée, puis nettoie l'état.
  const endDrag = () => { setDragId(null); setOverId(null); };

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
      <div className="mb-4 flex items-center justify-between gap-2">
        <p className="hidden text-[12px] text-muted-foreground sm:block">
          {editing ? "Glissez les blocs pour réordonner · renommez · masquez (œil) · pleine largeur (⤢)" : ""}
        </p>
        <div className="ml-auto flex items-center gap-1.5">
          {editing && (
            <button
              type="button" onClick={reset}
              className="inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-[12px] font-medium text-muted-foreground transition-colors hover:bg-secondary/60 hover:text-foreground"
            >
              <RotateCcw className="h-3.5 w-3.5" /> Réinitialiser
            </button>
          )}
          <button
            type="button" onClick={() => setEditing((e) => !e)}
            className={`inline-flex h-8 items-center gap-1.5 rounded-lg px-3 text-[12px] font-semibold transition-colors ${
              editing
                ? "bg-brand-600 text-white shadow-[0_2px_10px_-2px_hsl(var(--brand-600))] hover:bg-brand-700"
                : "border border-border bg-card text-muted-foreground hover:text-foreground hover:bg-secondary/60"
            }`}
          >
            {editing ? <><Check className="h-3.5 w-3.5" /> Terminer</> : <><SlidersHorizontal className="h-3.5 w-3.5" /> Personnaliser</>}
          </button>
        </div>
      </div>

      {/* Grille : 1 colonne (mobile) → 2 (lg) → 3 (xl+). Ordre de lecture
          gauche→droite (prévisible). Le passage à 3 colonnes dès `xl` (≈1280px)
          réduit fortement la hauteur (donc le scroll) sur les portables. Les
          blocs « pleine largeur » s'étendent sur toutes les colonnes via
          col-span-full. `items-start` = hauteur naturelle (alignement net). */}
      <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-2 xl:grid-cols-3">
        {effectiveOrder.map((id) => {
          const section = byId.get(id);
          if (!section) return null;
          const isHidden = hidden.has(id);
          if (isHidden && !editing) return null;

          const isWide = wide.has(id);
          const renamed = labels[id] != null && labels[id] !== section.label;
          const spanClass = isWide ? "col-span-full" : "";

          if (!editing) {
            return (
              <div key={id} className={spanClass}>
                {renamed && <p className="kicker mb-2 text-brand-600 dark:text-brand-400">{labelOf(id)}</p>}
                {section.node}
              </div>
            );
          }

          // Mode édition : ÉCHANGE uniquement. Toute la CARTE est glissable
          // (« prendre toute la case ») ; au pick-up, TOUS les autres blocs
          // s'allument (surbrillance simple = échangeables) et celui survolé
          // s'allume plus fort (surbrillance double). Déposer sur un bloc =
          // échange ; pour mettre en bas, la zone dédiée en fin de grille. Le
          // libellé n'est éditable qu'après le crayon ; contenu non-cliquable.
          const dragging = dragId === id;
          const cardEditing = editId === id;
          const dragActive = !!dragId;
          const isHovered = overId === `swap:${id}` && dragActive && !dragging;
          const isCandidate = dragActive && !dragging && !cardEditing;
          return (
            <div
              key={id}
              draggable={!cardEditing}
              onDragStart={cardEditing ? undefined : (e) => { e.dataTransfer.effectAllowed = "move"; setDragId(id); }}
              onDragEnd={endDrag}
              onDragOver={(e) => { if (dragId && !dragging) { e.preventDefault(); setOverId(`swap:${id}`); } }}
              onDrop={(e) => { e.preventDefault(); if (dragId && !dragging) swap(dragId, id); endDrag(); }}
              title={cardEditing ? undefined : "Glisser · déposer sur un autre bloc pour les échanger"}
              className={`relative rounded-xl transition-all duration-150 ${spanClass} ${cardEditing ? "" : "cursor-grab active:cursor-grabbing"} ${
                dragging ? "opacity-40 ring-2 ring-brand-500/50" : ""
              } ${
                isHovered
                  ? "ring-2 ring-brand-500 ring-offset-2 ring-offset-background bg-brand-500/[0.06] scale-[1.01] shadow-lg shadow-brand-500/10"
                  : isCandidate ? "ring-1 ring-brand-500/40 ring-offset-2 ring-offset-background" : ""
              }`}
            >
              <div className="flex items-center gap-2 mb-2 px-1">
                <span className="shrink-0 inline-flex h-8 items-center text-muted-foreground/50" aria-hidden>
                  <GripVertical className="h-4 w-4" />
                </span>
                {cardEditing ? (
                  <input
                    autoFocus
                    value={labelOf(id)}
                    onChange={(e) => rename(id, e.target.value)}
                    onBlur={() => setEditId(null)}
                    onKeyDown={(e) => { if (e.key === "Enter" || e.key === "Escape") setEditId(null); }}
                    aria-label={`Renommer ${section.label}`}
                    className="flex-1 min-w-0 h-8 px-2 rounded-md border border-border bg-background text-[13px] font-semibold text-foreground focus:outline-none focus:ring-2 focus:ring-brand-500"
                  />
                ) : (
                  <span className="flex-1 min-w-0 truncate py-1.5 text-[13px] font-semibold text-foreground">{labelOf(id)}</span>
                )}
                <button
                  type="button" draggable={false} onMouseDown={(e) => e.preventDefault()}
                  onClick={() => setEditId(cardEditing ? null : id)}
                  title={cardEditing ? "Valider le nom" : "Renommer le bloc"}
                  className="shrink-0 inline-flex items-center justify-center h-8 w-8 rounded-md text-muted-foreground hover:text-foreground hover:bg-secondary/60"
                >
                  {cardEditing ? <Check className="h-4 w-4 text-emerald-500" /> : <Pencil className="h-4 w-4" />}
                </button>
                <button
                  type="button" draggable={false} onClick={() => toggleWide(id)}
                  title={isWide ? "Réduire en colonne" : "Pleine largeur"}
                  className="shrink-0 inline-flex items-center justify-center h-8 w-8 rounded-md text-muted-foreground hover:text-foreground hover:bg-secondary/60"
                >
                  {isWide ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
                </button>
                <button
                  type="button" draggable={false} onClick={() => toggleHide(id)}
                  title={isHidden ? "Afficher" : "Masquer"}
                  className="shrink-0 inline-flex items-center justify-center h-8 w-8 rounded-md text-muted-foreground hover:text-foreground hover:bg-secondary/60"
                >
                  {isHidden ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
              {/* Contenu NON interactif en édition (réorganisation) → le glisser
                  démarre depuis toute la carte, aperçu visuel conservé. */}
              <div className={`pointer-events-none ${isHidden ? "opacity-40" : ""}`}>{section.node}</div>
            </div>
          );
        })}
        {/* Zone « mettre en bas » — grande, en fin de grille, seule action hors échange. */}
        {editing && dragId && (
          <div
            onDragOver={(e) => { e.preventDefault(); setOverId("bottom"); }}
            onDrop={(e) => { e.preventDefault(); moveBefore(dragId, null); endDrag(); }}
            className={`col-span-full flex items-center justify-center gap-2 h-16 rounded-xl border-2 border-dashed text-[13px] font-semibold transition-all duration-150 ${
              overId === "bottom"
                ? "border-brand-500 bg-brand-500/10 text-brand-600 dark:text-brand-400 scale-[1.005]"
                : "border-border text-muted-foreground"
            }`}
          >
            <ArrowDownToLine className="h-4 w-4" /> Déposer ici pour placer le bloc en bas
          </div>
        )}
      </div>
    </div>
  );
}
