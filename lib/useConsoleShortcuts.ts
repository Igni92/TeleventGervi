"use client";

import { useEffect, useState, useCallback } from "react";

/**
 * Raccourcis clavier de la console télévente — personnalisables et persistés
 * dans localStorage (clé `tv-console-shortcuts-v1`).
 *
 * Une action = une touche (pas de chord). Les lettres sont comparées en
 * casse-insensible ; les touches spéciales (Arrow*, Escape, etc.) en exact.
 */

export type ShortcutAction =
  | "searchFocus"
  | "openBL"
  | "demain"
  | "rappel"
  | "skip"
  | "navNext"
  | "navPrev";

export const SHORTCUT_LABELS: Record<ShortcutAction, string> = {
  searchFocus: "Focus recherche",
  openBL:      "Ouvrir la saisie BL",
  demain:      "Marquer « À demain »",
  rappel:      "Programmer un rappel",
  skip:        "Passer sans loguer",
  navNext:     "Client suivant",
  navPrev:     "Client précédent",
};

const DEFAULT_KEYMAP: Record<ShortcutAction, string> = {
  searchFocus: "/",
  openBL:      "c",
  demain:      "d",
  rappel:      "r",
  skip:        "s",
  navNext:     "ArrowDown",
  navPrev:     "ArrowUp",
};

const STORAGE_KEY = "tv-console-shortcuts-v1";

/** Étiquette d'affichage d'une touche (↑ au lieu de ArrowUp, C au lieu de c). */
export function displayKey(key: string): string {
  if (!key) return "—";
  if (key === "ArrowUp")    return "↑";
  if (key === "ArrowDown")  return "↓";
  if (key === "ArrowLeft")  return "←";
  if (key === "ArrowRight") return "→";
  if (key === " ")          return "Espace";
  if (key === "Escape")     return "Esc";
  if (key === "Enter")      return "Entrée";
  if (key === "Tab")        return "Tab";
  return key.length === 1 ? key.toUpperCase() : key;
}

/** Vrai si la touche est utilisable comme raccourci (filtre Shift/Ctrl seuls etc.). */
export function isBindableKey(key: string): boolean {
  if (!key) return false;
  // Touches modificatrices seules → non bindables
  if (["Shift", "Control", "Alt", "Meta", "CapsLock", "Tab"].includes(key)) return false;
  return true;
}

export function useConsoleShortcuts() {
  const [keymap, setKeymap] = useState<Record<ShortcutAction, string>>(DEFAULT_KEYMAP);
  const [hydrated, setHydrated] = useState(false);

  // Charge depuis localStorage
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as Partial<Record<ShortcutAction, string>>;
        // Merge avec les défauts (au cas où une nouvelle action est ajoutée)
        setKeymap({ ...DEFAULT_KEYMAP, ...parsed });
      }
    } catch { /* keep defaults */ }
    setHydrated(true);
  }, []);

  // Persiste à chaque changement (post-hydratation)
  useEffect(() => {
    if (!hydrated) return;
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(keymap)); } catch { /* ignore */ }
  }, [keymap, hydrated]);

  const remap = useCallback((action: ShortcutAction, key: string) => {
    setKeymap((cur) => ({ ...cur, [action]: key }));
  }, []);

  const reset = useCallback(() => setKeymap(DEFAULT_KEYMAP), []);

  /**
   * Test si un KeyboardEvent matche l'action donnée.
   * - Touches spéciales (length > 1) : comparaison exacte
   * - Lettres / chiffres / symboles (length === 1) : casse-insensible
   */
  const matches = useCallback((e: KeyboardEvent, action: ShortcutAction): boolean => {
    const bound = keymap[action];
    if (!bound) return false;
    // Les raccourcis sont des touches simples : on ignore toute combinaison avec
    // Ctrl/Cmd/Alt pour ne PAS détourner les raccourcis navigateur (Ctrl+R reload,
    // Ctrl+D favori, etc.). Shift est toléré (ex. caractères majuscules).
    if (e.ctrlKey || e.metaKey || e.altKey) return false;
    if (bound.length > 1) return e.key === bound;
    return e.key.toLowerCase() === bound.toLowerCase();
  }, [keymap]);

  return { keymap, hydrated, remap, reset, matches };
}
