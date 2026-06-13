"use client";

import { useEffect, useState, useCallback } from "react";

/**
 * Console display preferences — visibility, ordering AND collapsed state of
 * the active client view sections. Persisted in localStorage.
 *
 * Migration v1 → v2 : ajoute `collapsed` aux entrées existantes en utilisant
 * DEFAULT_COLLAPSED. La même clé de storage est conservée — l'ancien format
 * est lu tel quel puis fusionné avec les valeurs par défaut.
 */

export type SectionId =
  | "insights"
  | "jours"
  | "notes"
  | "history"
  | "rappels";

export const SECTION_LABELS: Record<SectionId, string> = {
  insights: "Analyse comportementale",
  jours:    "Jours d'appel",
  notes:    "Notes client",
  history:  "Historique commandes",
  rappels:  "Rappels planifiés",
};

export interface SectionPref {
  id: SectionId;
  visible: boolean;
  /** true = repliée par défaut (header seul affiché). */
  collapsed: boolean;
}

/** Repli par défaut — sections secondaires repliées pour alléger la fiche. */
const DEFAULT_COLLAPSED: Record<SectionId, boolean> = {
  insights: true,
  jours:    true,
  notes:    false,
  history:  false,
  rappels:  true,
};

/**
 * Visibilité par défaut — Console 1 vise la **vitesse d'appel**.
 * Les outils d'analyse/marge vivent désormais exclusivement sur l'Écran 2.
 */
const DEFAULT_VISIBLE: Record<SectionId, boolean> = {
  insights: true,
  jours:    true,
  notes:    true,
  history:  true,
  rappels:  true,
};

const DEFAULT_ORDER: SectionPref[] = (
  ["insights", "jours", "notes", "history", "rappels"] as SectionId[]
).map((id) => ({ id, visible: DEFAULT_VISIBLE[id], collapsed: DEFAULT_COLLAPSED[id] }));

/** SectionIds legacy fusionnés en `history` lors de la migration localStorage. */
const LEGACY_HISTORY_IDS = new Set(["activity", "sapOrders"]);
/**
 * SectionIds retirés depuis : `stock` (la consultation de stock vit sur
 * l'Écran 2 — Console 1 = vitesse d'appel uniquement). Les entrées
 * persistées sont ignorées silencieusement lors de la lecture.
 */
const DROPPED_IDS = new Set(["stock"]);

const STORAGE_KEY = "tv-console-prefs-v1";

export function useConsolePrefs() {
  const [prefs, setPrefs] = useState<SectionPref[]>(DEFAULT_ORDER);
  const [hydrated, setHydrated] = useState(false);

  // Load from localStorage on mount
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as Partial<SectionPref & { id: string }>[];
        const validIds = new Set(DEFAULT_ORDER.map((s) => s.id));

        // Migration legacy : `activity` + `sapOrders` fusionnées en `history`.
        // On insère `history` à la position de la 1ʳᵉ occurrence rencontrée
        // (préserve l'ordre choisi par l'utilisateur), on agrège la visibilité
        // (OR) et on garde l'état `collapsed` de la 1ʳᵉ occurrence. Les autres
        // occurrences sont déduppliquées.
        let legacyVisible = false;
        let legacyCollapsed: boolean | undefined;
        let legacySeen = false;
        for (const p of parsed) {
          if (p.id && LEGACY_HISTORY_IDS.has(p.id)) {
            legacyVisible = legacyVisible || (p.visible ?? true);
            if (!legacySeen) {
              legacyCollapsed = p.collapsed ?? DEFAULT_COLLAPSED.history;
              legacySeen = true;
            }
          }
        }

        const cleaned: SectionPref[] = [];
        let historyInserted = false;
        for (const p of parsed) {
          if (!p.id) continue;
          if (LEGACY_HISTORY_IDS.has(p.id)) {
            if (!historyInserted) {
              cleaned.push({
                id: "history",
                visible: legacyVisible,
                collapsed: legacyCollapsed ?? DEFAULT_COLLAPSED.history,
              });
              historyInserted = true;
            }
            continue;
          }
          if (DROPPED_IDS.has(p.id)) continue; // section retirée — ignore
          if (!validIds.has(p.id as SectionId)) continue;
          const id = p.id as SectionId;
          cleaned.push({
            id,
            visible: p.visible ?? true,
            collapsed: p.collapsed ?? DEFAULT_COLLAPSED[id],
          });
        }

        const missing = DEFAULT_ORDER.filter(
          (d) => !cleaned.some((c) => c.id === d.id),
        );
        setPrefs([...cleaned, ...missing]);
      }
    } catch {
      // Ignore parse errors — keep defaults
    }
    setHydrated(true);
  }, []);

  // Persist on change (after hydration)
  useEffect(() => {
    if (!hydrated) return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
    } catch {
      // localStorage full / disabled — silently ignore
    }
  }, [prefs, hydrated]);

  const toggleVisibility = useCallback((id: SectionId) => {
    setPrefs((cur) =>
      cur.map((p) => (p.id === id ? { ...p, visible: !p.visible } : p)),
    );
  }, []);

  const toggleCollapsed = useCallback((id: SectionId) => {
    setPrefs((cur) =>
      cur.map((p) => (p.id === id ? { ...p, collapsed: !p.collapsed } : p)),
    );
  }, []);

  /**
   * Move section `fromId` to a position relative to `toId`.
   *   position = "before" → insert just before toId
   *   position = "after"  → insert just after toId
   */
  const reorder = useCallback((
    fromId: SectionId,
    toId: SectionId,
    position: "before" | "after" = "before",
  ) => {
    if (fromId === toId) return;
    setPrefs((cur) => {
      const fromIdx = cur.findIndex((p) => p.id === fromId);
      const toIdx = cur.findIndex((p) => p.id === toId);
      if (fromIdx === -1 || toIdx === -1) return cur;

      const next = [...cur];
      const [moved] = next.splice(fromIdx, 1);

      // Recompute target index after splice removal
      const adjustedTo = fromIdx < toIdx ? toIdx - 1 : toIdx;
      const insertAt = position === "after" ? adjustedTo + 1 : adjustedTo;

      next.splice(insertAt, 0, moved);
      return next;
    });
  }, []);

  const reset = useCallback(() => setPrefs(DEFAULT_ORDER), []);

  return { prefs, hydrated, toggleVisibility, toggleCollapsed, reorder, reset };
}
