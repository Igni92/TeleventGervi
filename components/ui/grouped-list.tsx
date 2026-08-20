"use client";

import * as React from "react";
import { Slot, Slottable } from "@radix-ui/react-slot";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * <GroupedList /> + <GroupedRow /> — liste groupée « insérée » (motif iOS),
 * brique de base de la refonte : une surface card cerclée d'un filet, des
 * rangées séparées par des hairlines internes. Le titre (kicker) vit AU-DESSUS
 * de la surface, jamais dedans.
 */

export interface GroupedListProps
  extends Omit<React.HTMLAttributes<HTMLDivElement>, "title"> {
  /** Kicker rendu au-dessus de la surface. */
  title?: React.ReactNode;
  /** Légende caption sous la surface (mentions, aide contextuelle). */
  footer?: React.ReactNode;
  /** Zébrage une rangée sur deux (lisibilité façon tableur). Défaut true. */
  zebra?: boolean;
}

const GroupedList = React.forwardRef<HTMLDivElement, GroupedListProps>(
  ({ title, footer, zebra = true, className, children, ...props }, ref) => (
    <div ref={ref} className={className} {...props}>
      {/* px-4 : aligne kicker et footer sur le padding interne des rangées. */}
      {title != null && <div className="kicker mb-2 px-4">{title}</div>}
      {/* divide-y : le séparateur n'existe qu'ENTRE les rangées, pas après la
          dernière — un border-b par rangée laisserait un filet orphelin. */}
      <div className={cn(
        "divide-y divide-border overflow-hidden rounded-xl bg-card ring-1 ring-border shadow-card",
        zebra && "[&>*:nth-child(even)]:bg-muted/40",
      )}>
        {children}
      </div>
      {footer != null && (
        <p className="mt-2 px-4 text-caption text-muted-foreground">{footer}</p>
      )}
    </div>
  )
);
GroupedList.displayName = "GroupedList";

export interface GroupedRowProps
  extends Omit<React.HTMLAttributes<HTMLElement>, "title"> {
  label?: React.ReactNode;
  /** Ligne secondaire caption sous le label. */
  sublabel?: React.ReactNode;
  /** Valeur alignée à droite (body muted). */
  value?: React.ReactNode;
  /** Force/masque le chevron ; par défaut visible si la rangée est navigable. */
  chevron?: boolean;
  disabled?: boolean;
  /** Rangée d'action dangereuse : label et chevron en --destructive. */
  destructive?: boolean;
  /** Fusionne la rangée dans l'enfant (ex. <Link>) via Radix Slot. */
  asChild?: boolean;
}

const GroupedRow = React.forwardRef<HTMLElement, GroupedRowProps>(
  (
    {
      label,
      sublabel,
      value,
      chevron,
      onClick,
      disabled,
      destructive,
      asChild = false,
      className,
      children,
      ...props
    },
    ref
  ) => {
    const interactive = asChild || onClick != null;
    const showChevron = chevron ?? interactive;
    // `React.ElementType` volontairement large : la rangée est un <button>
    // quand elle est cliquable, un <div> sinon, un Slot en asChild.
    const Comp: React.ElementType = asChild ? Slot : interactive ? "button" : "div";
    return (
      <Comp
        ref={ref}
        onClick={onClick}
        {...(Comp === "button" ? { type: "button", disabled } : {})}
        aria-disabled={disabled || undefined}
        className={cn(
          "flex min-h-11 w-full items-center gap-3 px-4 py-2 text-left",
          interactive && [
            "cursor-pointer transition-colors duration-[var(--dur-fast)] ease-[var(--ease-apple)]",
            "hover:bg-secondary/60 active:bg-secondary",
            // Un ring de focus serait rogné par l'overflow-hidden du conteneur :
            // le focus clavier reprend le fond de survol à la place.
            "focus-visible:bg-secondary/60 focus-visible:outline-none",
          ],
          disabled && "pointer-events-none opacity-50",
          className
        )}
        {...props}
      >
        {(label != null || sublabel != null) && (
          <span className="min-w-0 flex-1">
            {label != null && (
              <span
                className={cn(
                  "block truncate text-body",
                  destructive ? "text-destructive" : "text-foreground"
                )}
              >
                {label}
              </span>
            )}
            {sublabel != null && (
              <span className="block truncate text-caption text-muted-foreground">
                {sublabel}
              </span>
            )}
          </span>
        )}
        {/* Slottable : en asChild, les enfants de l'élément fourni s'insèrent
            ICI, entre le bloc label et la valeur/chevron générés. */}
        <Slottable>{children}</Slottable>
        {value != null && (
          <span className="shrink-0 text-body text-muted-foreground">{value}</span>
        )}
        {showChevron && (
          <ChevronRight
            size={16}
            aria-hidden="true"
            className={cn(
              "shrink-0",
              destructive ? "text-destructive/70" : "text-muted-foreground"
            )}
          />
        )}
      </Comp>
    );
  }
);
GroupedRow.displayName = "GroupedRow";

export { GroupedList, GroupedRow };
