"use client";

import { cn } from "@/lib/utils";

/**
 * <StatBlock /> — mini-stat d'en-tête de liste (label kicker + valeur héros).
 *
 * Remplace les `function Stat` locales dupliquées à l'identique dans
 * GoodsReceiptHistory, PurchaseOrderHistory, InventairePanel, Encours…
 * La VALEUR est l'info importante : grande, font-display, blanche (ou teintée
 * par `tone` pour l'argent/l'alerte). Le label reste discret.
 */
export type StatTone = "default" | "emerald" | "amber" | "rose" | "brand" | "sky" | "violet";
export type StatSize = "sm" | "md" | "lg";

const TONE: Record<StatTone, string> = {
  default: "text-foreground",
  emerald: "text-emerald-600 dark:text-emerald-400",
  amber:   "text-amber-600 dark:text-amber-400",
  rose:    "text-rose-600 dark:text-rose-400",
  brand:   "text-primary",
  sky:     "text-sky-600 dark:text-sky-400",
  violet:  "text-violet-600 dark:text-violet-400",
};

const SIZE: Record<StatSize, string> = {
  sm: "text-[17px]",
  md: "text-[20px]",
  lg: "text-[24px]",
};

export function StatBlock({
  label,
  value,
  tone = "default",
  size = "lg",
  className,
}: {
  label: React.ReactNode;
  value: React.ReactNode;
  tone?: StatTone;
  size?: StatSize;
  className?: string;
}) {
  return (
    <div className={className}>
      <div className="text-[10.5px] uppercase tracking-[0.14em] text-muted-foreground font-semibold">
        {label}
      </div>
      <div className={cn("font-display font-bold tnum leading-tight", SIZE[size], TONE[tone])}>
        {value}
      </div>
    </div>
  );
}
