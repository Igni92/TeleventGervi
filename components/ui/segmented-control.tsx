"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * <SegmentedControl /> — sélecteur segmenté (motif iOS) : les items reposent
 * dans un creux bg-secondary, l'item sélectionné est une pastille card qui
 * porte la seule ombre. Remplace les rangées de boutons filtres ad hoc.
 *
 * Composant volontairement SANS forwardRef : générique sur la valeur
 * (forwardRef ne préserve pas les génériques sans contorsions de typage).
 */

export interface SegmentedControlOption<T extends string = string> {
  value: T;
  label: React.ReactNode;
  icon?: React.ReactNode;
}

export interface SegmentedControlProps<T extends string = string> {
  value: T;
  onChange: (value: T) => void;
  options: SegmentedControlOption<T>[];
  size?: "sm" | "md";
  className?: string;
  /** Libellé accessible du groupe (aria-label du tablist). */
  "aria-label"?: string;
}

function SegmentedControl<T extends string = string>({
  value,
  onChange,
  options,
  size = "md",
  className,
  "aria-label": ariaLabel,
}: SegmentedControlProps<T>) {
  const itemRefs = React.useRef<(HTMLButtonElement | null)[]>([]);
  const selectedIdx = options.findIndex((o) => o.value === value);
  // Roving tabindex : un seul item tabbable ; repli sur le premier si la
  // valeur courante ne correspond à aucune option.
  const tabbableIdx = selectedIdx >= 0 ? selectedIdx : 0;

  // Flèches = sélection directe (modèle iOS/tablist à activation automatique),
  // le focus suit la sélection.
  const handleKeyDown = (e: React.KeyboardEvent) => {
    let next = -1;
    if (e.key === "ArrowRight" || e.key === "ArrowDown") {
      next = (tabbableIdx + 1) % options.length;
    } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
      next = (tabbableIdx - 1 + options.length) % options.length;
    } else if (e.key === "Home") {
      next = 0;
    } else if (e.key === "End") {
      next = options.length - 1;
    }
    if (next < 0) return;
    e.preventDefault();
    onChange(options[next].value);
    itemRefs.current[next]?.focus();
  };

  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      onKeyDown={handleKeyDown}
      className={cn("flex items-stretch rounded-lg bg-secondary p-0.5", className)}
    >
      {options.map((opt, i) => {
        const selected = i === selectedIdx;
        return (
          <button
            key={opt.value}
            ref={(el) => {
              itemRefs.current[i] = el;
            }}
            type="button"
            role="tab"
            aria-selected={selected}
            tabIndex={i === tabbableIdx ? 0 : -1}
            onClick={() => onChange(opt.value)}
            className={cn(
              "flex min-w-0 flex-1 items-center justify-center gap-1.5 whitespace-nowrap rounded-md text-caption font-semibold",
              "transition-[background-color,color,box-shadow] duration-[var(--dur-fast)] ease-[var(--ease-apple)]",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              "[&_svg]:size-3.5 [&_svg]:shrink-0",
              size === "sm" ? "h-6 px-2" : "h-7 px-3",
              selected
                ? // Contour 0.5px + ombre neutre : la pastille semble posée dans
                  // le creux, sans teinte (contrat ombres du design system).
                  "bg-card text-foreground shadow-[0_0_0_0.5px_rgba(0,0,0,0.06),0_1px_3px_rgba(0,0,0,0.12)]"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            {opt.icon}
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

export { SegmentedControl };
