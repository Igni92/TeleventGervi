"use client";

import { useEffect, useState } from "react";
import { Settings } from "lucide-react";
import {
  SHORTCUT_LABELS, displayKey, isBindableKey, type ShortcutAction,
} from "@/lib/useConsoleShortcuts";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import { InfoHint } from "@/components/ui/info-hint";

/* ── Shortcuts customization dialog ────────────────────────── */
export function ShortcutsDialog({
  open, onOpenChange, keymap, remap, reset,
}: {
  open: boolean;
  onOpenChange: (b: boolean) => void;
  keymap: Record<ShortcutAction, string>;
  remap: (action: ShortcutAction, key: string) => void;
  reset: () => void;
}) {
  // Quand l'utilisateur clique sur "Modifier" pour une action, on capture la
  // prochaine touche pressée (Esc pour annuler).
  const [capturing, setCapturing] = useState<ShortcutAction | null>(null);

  useEffect(() => {
    if (!capturing) return;
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.key === "Escape") { setCapturing(null); return; }
      if (!isBindableKey(e.key)) return;
      remap(capturing, e.key);
      setCapturing(null);
    };
    // capture phase pour court-circuiter les autres handlers globaux
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [capturing, remap]);

  // Reset la capture si le dialog se ferme
  useEffect(() => { if (!open) setCapturing(null); }, [open]);

  // Détection de conflits — touche utilisée par 2 actions
  const usage = new Map<string, number>();
  (Object.values(keymap)).forEach((k) => usage.set(k.toLowerCase(), (usage.get(k.toLowerCase()) ?? 0) + 1));

  const actions: ShortcutAction[] = ["searchFocus", "openBL", "demain", "rappel", "navNext", "navPrev"];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-[18px] font-semibold tracking-tight">
            <Settings className="h-5 w-5 text-brand-600 dark:text-brand-400" />
            Raccourcis clavier
          </DialogTitle>
          <DialogDescription className="text-[12.5px] text-muted-foreground mt-1">
            Clique sur une touche pour la remplacer. Persisté localement.
          </DialogDescription>
        </DialogHeader>

        <ul className="mt-2 divide-y divide-border">
          {actions.map((a) => {
            const key = keymap[a];
            const isConflict = (usage.get(key?.toLowerCase() ?? "") ?? 0) > 1;
            const isCapturing = capturing === a;
            return (
              <li key={a} className="flex items-center gap-3 py-2.5">
                <span className="flex-1 text-[13px] text-foreground">{SHORTCUT_LABELS[a]}</span>
                {isConflict && !isCapturing && (
                  <>
                    <span className="text-[10px] uppercase tracking-wider font-semibold px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300">
                      conflit
                    </span>
                    <InfoHint label="Conflit de touche" size={14}>
                      Cette touche est partagée avec une autre action
                    </InfoHint>
                  </>
                )}
                <button
                  type="button"
                  onClick={() => setCapturing(isCapturing ? null : a)}
                  className={`min-w-[88px] inline-flex items-center justify-center px-2.5 py-1.5 rounded-md border text-[12px] font-mono transition-colors ${
                    isCapturing
                      ? "border-brand-500 bg-brand-50 text-brand-700 dark:bg-brand-950/40 dark:text-brand-300 animate-pulse"
                      : "border-border bg-secondary/40 hover:border-brand-400 text-foreground"
                  }`}
                >
                  {isCapturing ? "Pressez une touche…" : displayKey(key)}
                </button>
              </li>
            );
          })}
        </ul>

        <div className="flex items-center justify-between mt-3 pt-3 border-t border-border">
          <button
            type="button"
            onClick={reset}
            className="text-[12px] text-muted-foreground hover:text-foreground transition-colors"
          >
            Réinitialiser les défauts
          </button>
          <Button size="sm" variant="secondary" onClick={() => onOpenChange(false)}>
            Fermer
          </Button>
        </div>

        <p className="text-[10.5px] text-muted-foreground/70 mt-2 leading-snug">
          Astuce : <kbd className="font-mono bg-secondary/60 px-1 rounded">Esc</kbd> pendant
          la capture annule. Les modificateurs seuls (Shift, Ctrl…) ne sont pas acceptés.
        </p>
      </DialogContent>
    </Dialog>
  );
}
