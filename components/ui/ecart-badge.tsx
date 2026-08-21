import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * <EcartBadge /> — écart d'inventaire, sémantique UNIFIÉE dans tout le pôle :
 *   écart = réel − SAP (en colis).
 *     · 0        → conforme (emerald)
 *     · négatif  → MANQUE   (ambre)
 *     · positif  → EXCÉDENT (bleu)
 * Deux variantes : « pill » (pastille, tableaux/comparatif) et « plain »
 * (texte coloré seul, lignes de récap). Remplace les colorations ad hoc.
 */

/** Nb de colis : entier si rond, sinon 1 décimale (virgule FR). */
export function fmtEcart(n: number): string {
  const r = Math.round(n * 10) / 10;
  return Number.isInteger(r) ? String(r) : r.toFixed(1).replace(".", ",");
}

type Sens = "ok" | "manque" | "excedent";
const sensOf = (ecart: number): Sens =>
  Math.abs(ecart) <= 0.001 ? "ok" : ecart < 0 ? "manque" : "excedent";

const PILL: Record<Sens, string> = {
  ok: "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300",
  manque: "bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-300",
  excedent: "bg-sky-100 text-sky-700 dark:bg-sky-500/20 dark:text-sky-300",
};
const PLAIN: Record<Sens, string> = {
  ok: "text-emerald-600 dark:text-emerald-400",
  manque: "text-amber-600 dark:text-amber-400",
  excedent: "text-sky-600 dark:text-sky-400",
};

/** Libellé signé : « OK » à l'équilibre, sinon « +n » / « −n » (moins typographique). */
export function ecartLabel(ecart: number): string {
  if (Math.abs(ecart) <= 0.001) return "OK";
  return ecart > 0 ? `+${fmtEcart(ecart)}` : `−${fmtEcart(Math.abs(ecart))}`;
}

export interface EcartBadgeProps {
  /** Écart en colis (réel − SAP). */
  ecart: number;
  /** Unité affichée après la valeur (« colis »). */
  unit?: string;
  /** « pill » = pastille (défaut) ; « plain » = texte coloré seul. */
  variant?: "pill" | "plain";
  className?: string;
}

export function EcartBadge({ ecart, unit, variant = "pill", className }: EcartBadgeProps) {
  const sens = sensOf(ecart);
  const label = ecartLabel(ecart);
  if (variant === "plain") {
    return (
      <span className={cn("text-body font-bold tnum", PLAIN[sens], className)}>
        {label}
        {unit && ecart !== 0 ? ` ${unit}` : ""}
      </span>
    );
  }
  return (
    <span
      className={cn(
        "inline-flex min-w-[46px] justify-center rounded-md px-1.5 py-0.5 text-caption font-bold tnum",
        PILL[sens],
        className,
      )}
    >
      {label}
      {unit && ecart !== 0 ? ` ${unit}` : ""}
    </span>
  );
}
