"use client";

import { Settings } from "lucide-react";
import { displayKey, type ShortcutAction } from "@/lib/useConsoleShortcuts";

export function KeyboardHints({
  keymap, onOpenSettings,
}: {
  keymap: Record<ShortcutAction, string>;
  onOpenSettings: () => void;
}) {
  const hints: [string, string][] = [
    [displayKey(keymap.searchFocus), "Recherche"],
    [`${displayKey(keymap.navPrev)}${displayKey(keymap.navNext)}`, "Naviguer"],
    [displayKey(keymap.openBL), "Commande (BL)"],
    [displayKey(keymap.demain), "À demain"],
    [displayKey(keymap.rappel), "Rappel"],
    [displayKey(keymap.skip), "Passer"],
  ];
  return (
    <footer className="hidden md:flex items-center justify-end gap-4 flex-wrap text-[11px] text-muted-foreground">
      {hints.map(([k, l]) => (
        <span key={l} className="flex items-center gap-1.5">
          <kbd className="font-mono bg-secondary/60 border border-border px-1.5 py-0.5 rounded text-[10px] text-foreground/70">
            {k}
          </kbd>
          {l}
        </span>
      ))}
      <button
        type="button"
        onClick={onOpenSettings}
        className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors underline-offset-2 hover:underline"
        title="Personnaliser les raccourcis clavier"
      >
        <Settings className="h-3 w-3" />
        Personnaliser
      </button>
    </footer>
  );
}
