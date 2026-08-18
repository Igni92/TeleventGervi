"use client";

import * as React from "react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * <EmptyState /> — état vide sobre et centré : icône lucide fine, titre
 * callout, description body muted. Remplace les blocs « Aucun résultat »
 * ad hoc. Aucun emoji, aucun néon.
 */

export interface EmptyStateProps
  extends Omit<React.HTMLAttributes<HTMLDivElement>, "title"> {
  /** Composant d'icône lucide (pas un élément) : rendu 32px, trait 1.5. */
  icon?: LucideIcon;
  title: React.ReactNode;
  description?: React.ReactNode;
  /** Bouton d'action — passer un <Button> tinted (hiérarchie UIKit). */
  action?: React.ReactNode;
}

const EmptyState = React.forwardRef<HTMLDivElement, EmptyStateProps>(
  ({ icon: Icon, title, description, action, className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn(
        "flex flex-col items-center justify-center px-6 py-12 text-center",
        className
      )}
      {...props}
    >
      {Icon && (
        <Icon
          size={32}
          strokeWidth={1.5}
          aria-hidden="true"
          className="mb-3 text-muted-foreground"
        />
      )}
      <div className="text-callout font-medium text-foreground">{title}</div>
      {description != null && (
        <p className="mt-1 max-w-sm text-body text-muted-foreground">{description}</p>
      )}
      {action != null && <div className="mt-4">{action}</div>}
    </div>
  )
);
EmptyState.displayName = "EmptyState";

export { EmptyState };
