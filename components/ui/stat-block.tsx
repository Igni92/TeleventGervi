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
export type StatTone = "default" | "emerald" | "amber" | "rose" | "brand";

const TONE: Record<StatTone, string> = {
  default: "text-foreground",
  emerald: "text-emerald-600 dark:text-emerald-400",
  amber:   "text-amber-600 dark:text-amber-400",
  rose:    "text-rose-600 dark:text-rose-400",
  brand:   "text-primary",
};

export function StatBlock({
  label,
  value,
  tone = "default",
  className,
}: {
  label: string;
  value: React.ReactNode;
  tone?: StatTone;
  className?: string;
}) {
  return (
    <div className={className}>
      <div className="text-[10.5px] uppercase tracking-[0.14em] text-muted-foreground font-semibold">
        {label}
      </div>
      <div className={cn("font-display text-[24px] font-bold tnum leading-tight", TONE[tone])}>
        {value}
      </div>
    </div>
  );
}
