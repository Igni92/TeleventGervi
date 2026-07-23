"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { createPortal } from "react-dom";
import { ChevronDown, Plus, X, Check } from "lucide-react";
import { toast } from "sonner";

interface TypeOption { id: string; label: string }

/**
 * Liste déroulante INCRÉMENTALE et réutilisable.
 * - choisir un libellé existant
 * - en créer un nouveau (réutilisable ensuite)
 * - en supprimer de la liste (×)
 * Utilisée pour les types de contact, les types d'incident, etc. (param `kind`).
 *
 * Le menu est rendu dans un PORTAL (position fixe) : les comboboxes vivent
 * souvent dans une carte `overflow-hidden` (SectionCard) qui, sinon, ROGNE le
 * bas du menu — donc le bouton « Créer » — et rend la création impossible.
 */
export function TypeCombobox({
  kind, value, onChange, placeholder = "Type…", className = "",
}: {
  kind: string;
  value: string | null;
  onChange: (label: string) => void;
  placeholder?: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [types, setTypes] = useState<TypeOption[]>([]);
  const [query, setQuery] = useState("");
  const btnRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number; width: number } | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/types?kind=${encodeURIComponent(kind)}`);
      const json = await res.json();
      setTypes(json.types ?? []);
    } catch { /* liste optionnelle — on garde ce qu'on a */ }
  }, [kind]);

  useEffect(() => { load(); }, [load]);

  // Position du menu (portal) sous le bouton, en coordonnées viewport.
  const reposition = useCallback(() => {
    const el = btnRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setPos({ top: r.bottom + 4, left: r.left, width: r.width });
  }, []);
  const openMenu = () => { reposition(); setOpen(true); };

  // Ferme au clic extérieur (bouton OU menu portalisé) + repositionne au scroll.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (btnRef.current?.contains(t) || panelRef.current?.contains(t)) return;
      setOpen(false);
    };
    const onScroll = () => reposition();
    document.addEventListener("mousedown", onDown);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onScroll);
    return () => {
      document.removeEventListener("mousedown", onDown);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onScroll);
    };
  }, [open, reposition]);

  const q = query.trim().toLowerCase();
  const filtered = q ? types.filter((t) => t.label.toLowerCase().includes(q)) : types;
  const exactMatch = types.find((t) => t.label.toLowerCase() === q) ?? null;

  const pick = (label: string) => { onChange(label); setQuery(""); setOpen(false); };

  const createAndPick = async (label: string) => {
    const lbl = label.trim();
    if (!lbl) return;
    // Déjà dans la liste (au libellé près) → on sélectionne, pas de doublon.
    const existing = types.find((t) => t.label.toLowerCase() === lbl.toLowerCase());
    if (existing) { pick(existing.label); return; }
    try {
      const res = await fetch("/api/types", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind, label: lbl }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => null);
        toast.error(j?.error || "Impossible de créer ce type");
        return;
      }
      await load();
      pick(lbl);
    } catch {
      toast.error("Impossible de créer ce type (réseau)");
    }
  };

  // Entrée : sélectionne la correspondance exacte si elle existe, sinon crée.
  const onEnter = () => {
    if (!q) return;
    if (exactMatch) pick(exactMatch.label);
    else createAndPick(query);
  };

  const removeType = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    try { await fetch(`/api/types?id=${id}`, { method: "DELETE" }); await load(); }
    catch { toast.error("Suppression impossible"); }
  };

  return (
    <div className={`relative ${className}`}>
      <button
        ref={btnRef}
        type="button"
        onClick={() => (open ? setOpen(false) : openMenu())}
        className="w-full h-8 px-2.5 rounded-md border border-border bg-background text-[12.5px] flex items-center justify-between gap-2 hover:border-foreground/30"
      >
        <span className={`truncate ${value ? "text-foreground" : "text-muted-foreground"}`}>{value || placeholder}</span>
        <ChevronDown className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
      </button>

      {open && pos && createPortal(
        <div
          ref={panelRef}
          data-floating-root=""
          style={{ position: "fixed", top: pos.top, left: pos.left, width: Math.max(pos.width, 176), zIndex: 100 }}
          className="rounded-lg border border-border bg-card shadow-modal p-1.5"
        >
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") { e.preventDefault(); onEnter(); }
              else if (e.key === "Escape") { e.preventDefault(); setOpen(false); }
            }}
            placeholder="Rechercher ou créer…"
            className="w-full h-7 px-2 mb-1 rounded border border-border bg-background text-[12px] focus:outline-none focus:ring-1 focus:ring-brand-500"
          />
          <ul className="max-h-48 overflow-y-auto">
            {value && (
              <li>
                <button type="button" onClick={() => pick("")} className="w-full text-left px-2 py-1 rounded text-[11.5px] text-muted-foreground hover:bg-secondary/60">
                  — Aucun
                </button>
              </li>
            )}
            {filtered.map((t) => (
              <li key={t.id} className="group flex items-center">
                <button type="button" onClick={() => pick(t.label)}
                  className="flex-1 text-left px-2 py-1 rounded text-[12.5px] hover:bg-secondary/60 inline-flex items-center gap-1.5">
                  {value === t.label && <Check className="h-3 w-3 text-brand-500" />}
                  <span className={value === t.label ? "font-medium" : ""}>{t.label}</span>
                </button>
                <button type="button" onClick={(e) => removeType(e, t.id)} title="Supprimer ce type"
                  className="h-6 w-6 inline-flex items-center justify-center rounded text-muted-foreground/30 hover:text-rose-500 opacity-0 group-hover:opacity-100 transition-opacity">
                  <X className="h-3 w-3" />
                </button>
              </li>
            ))}
            {q && !exactMatch && (
              <li>
                <button type="button" onClick={() => createAndPick(query)}
                  className="w-full text-left px-2 py-1 rounded text-[12.5px] text-brand-600 dark:text-brand-400 hover:bg-brand-50 dark:hover:bg-brand-950/30 inline-flex items-center gap-1.5">
                  <Plus className="h-3 w-3" /> Créer « {query.trim()} »
                </button>
              </li>
            )}
            {filtered.length === 0 && !q && (
              <li className="px-2 py-1.5 text-[11.5px] italic text-muted-foreground">Aucun type — tape pour en créer un.</li>
            )}
          </ul>
        </div>,
        document.body,
      )}
    </div>
  );
}
