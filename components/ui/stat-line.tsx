"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * <StatLine /> — bande horizontale de stats SANS cartes : la valeur (title2,
 * chiffres tabulaires) au-dessus d'un label caption muted, les éléments
 * séparés par des filets verticaux hairline. Le `tone` ne colore QUE la
 * valeur, jamais le label.
 */

export type StatLineTone = "default" | "success" | "warning" | "danger";

export interface StatLineItem {
  label: React.ReactNode;
  value: React.ReactNode;
  /** Précision caption2 sous le label (ex. « vs S-1 »). */
  hint?: React.ReactNode;
  tone?: StatLineTone;
  onClick?: () => void;
}

export interface StatLineProps {
  items: StatLineItem[];
  className?: string;
}

const TONE: Record<StatLineTone, string> = {
  default: "text-foreground",
  success: "text-success",
  warning: "text-warning",
  danger: "text-destructive",
};

function StatLine({ items, className }: StatLineProps) {
  return (
    // Wrap propre : chaque élément porte son filet GAUCHE, et le conteneur
    // interne est décalé de (padding + hairline) vers la gauche pour que le
    // filet du premier élément de CHAQUE ligne sorte de la zone visible
    // (overflow-hidden). `divide-x` laisserait un filet orphelin en début de
    // 2e ligne après un retour à la ligne mobile.
    <div className={cn("overflow-hidden", className)}>
      <div className="-ml-[calc(1rem_+_var(--hairline))] flex flex-wrap gap-y-3">
        {items.map((item, i) => {
          const content = (
            <>
              <div className={cn("text-title3 sm:text-title2 tnum", TONE[item.tone ?? "default"])}>
                {item.value}
              </div>
              <div className="text-caption text-muted-foreground">{item.label}</div>
              {item.hint != null && (
                <div className="text-caption2 text-muted-foreground/80">{item.hint}</div>
              )}
            </>
          );
          const itemClass = cn(
            "border-l-[length:var(--hairline)] border-border px-4 text-left"
          );
          return item.onClick ? (
            <button
              key={i}
              type="button"
              onClick={item.onClick}
              className={cn(
                itemClass,
                "rounded-md transition-colors duration-[var(--dur-fast)] ease-[var(--ease-apple)]",
                "hover:bg-secondary/60 active:bg-secondary",
                "focus-visible:bg-secondary/60 focus-visible:outline-none"
              )}
            >
              {content}
            </button>
          ) : (
            <div key={i} className={itemClass}>
              {content}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export { StatLine };
