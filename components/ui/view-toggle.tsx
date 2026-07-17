"use client";

import { useCallback, useEffect, useState } from "react";
import { LayoutGrid, List } from "lucide-react";

/** Bascule d'affichage d'une liste : vue CARTES (visuel riche) ou LISTE classique
 *  (tableau compact). Réutilisé sur Fournisseurs / Clients / Articles. */
export type ViewMode = "cards" | "list";

export function ViewToggle({ value, onChange }: { value: ViewMode; onChange: (v: ViewMode) => void }) {
  const opts: [ViewMode, typeof LayoutGrid, string][] = [
    ["cards", LayoutGrid, "Cartes"],
    ["list", List, "Liste"],
  ];
  return (
    <div className="inline-flex rounded-lg border border-border bg-card p-0.5" role="group" aria-label="Affichage">
      {opts.map(([m, Icon, label]) => (
        <button
          key={m}
          type="button"
          onClick={() => onChange(m)}
          title={`Vue ${label.toLowerCase()}`}
          aria-pressed={value === m}
          className={`inline-flex items-center gap-1.5 px-2.5 h-8 rounded-md text-[12.5px] font-medium transition-colors ${
            value === m ? "bg-brand-500 text-white shadow-sm" : "text-muted-foreground hover:text-foreground hover:bg-secondary/60"
          }`}
        >
          <Icon className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">{label}</span>
        </button>
      ))}
    </div>
  );
}

/** État de vue persisté en localStorage (par écran). */
export function useViewMode(storageKey: string, initial: ViewMode = "cards") {
  const [mode, setMode] = useState<ViewMode>(initial);
  useEffect(() => {
    try {
      const v = localStorage.getItem(storageKey);
      if (v === "cards" || v === "list") setMode(v);
    } catch { /* localStorage indisponible */ }
  }, [storageKey]);
  const set = useCallback((v: ViewMode) => {
    setMode(v);
    try { localStorage.setItem(storageKey, v); } catch { /* ignore */ }
  }, [storageKey]);
  return [mode, set] as const;
}
