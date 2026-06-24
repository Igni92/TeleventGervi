"use client";

import { ChevronUp, ChevronDown, ChevronsUpDown } from "lucide-react";

export type SortDir = "asc" | "desc";

/** Flèche de tri pour les en-têtes de colonnes cliquables. */
export function SortArrow({ active, dir }: { active: boolean; dir: SortDir }) {
  if (!active) return <ChevronsUpDown className="h-3 w-3 opacity-30 shrink-0" />;
  return dir === "asc"
    ? <ChevronUp className="h-3 w-3 shrink-0 text-brand-600 dark:text-brand-400" />
    : <ChevronDown className="h-3 w-3 shrink-0 text-brand-600 dark:text-brand-400" />;
}

/** Bascule de tri : 1er clic = asc, 2e = desc, sur une nouvelle colonne = asc. */
export function nextSort(
  current: { key: string | null; dir: SortDir },
  key: string,
): { key: string | null; dir: SortDir } {
  if (current.key !== key) return { key, dir: "asc" };
  if (current.dir === "asc") return { key, dir: "desc" };
  return { key: null, dir: "asc" }; // 3e clic = retour au tri par défaut
}
