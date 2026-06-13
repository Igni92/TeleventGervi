"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { ChevronDown, Plus, X, Check } from "lucide-react";

interface TypeOption { id: string; label: string }

/**
 * Liste déroulante INCRÉMENTALE et réutilisable.
 * - choisir un libellé existant
 * - en créer un nouveau (réutilisable ensuite)
 * - en supprimer de la liste (×)
 * Utilisée pour les types de contact, les types d'incident, etc. (param `kind`).
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
  const ref = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/types?kind=${encodeURIComponent(kind)}`);
      const json = await res.json();
      setTypes(json.types ?? []);
    } catch { /* ignore */ }
  }, [kind]);

  useEffect(() => { load(); }, [load]);

  // Fermeture au clic extérieur
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const q = query.trim().toLowerCase();
  const filtered = q ? types.filter((t) => t.label.toLowerCase().includes(q)) : types;
  const exactExists = types.some((t) => t.label.toLowerCase() === q);

  const pick = (label: string) => { onChange(label); setQuery(""); setOpen(false); };

  const createAndPick = async (label: string) => {
    const lbl = label.trim();
    if (!lbl) return;
    try {
      await fetch("/api/types", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind, label: lbl }),
      });
      await load();
    } catch { /* ignore */ }
    pick(lbl);
  };

  const removeType = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    try { await fetch(`/api/types?id=${id}`, { method: "DELETE" }); await load(); } catch { /* ignore */ }
  };

  return (
    <div ref={ref} className={`relative ${className}`}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full h-8 px-2.5 rounded-md border border-border bg-background text-[12.5px] flex items-center justify-between gap-2 hover:border-foreground/30"
      >
        <span className={value ? "text-foreground" : "text-muted-foreground"}>{value || placeholder}</span>
        <ChevronDown className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
      </button>

      {open && (
        <div className="absolute z-50 mt-1 w-full rounded-lg border border-border bg-card shadow-modal p-1.5">
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && q && !exactExists) { e.preventDefault(); createAndPick(query); } }}
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
            {q && !exactExists && (
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
        </div>
      )}
    </div>
  );
}
