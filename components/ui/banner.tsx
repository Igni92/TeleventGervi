"use client";

import * as React from "react";
import {
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  Info,
  X,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * <Banner /> — bandeau de statut inséré : fond translucide du ton (10 %),
 * filet assorti (25 %), icône lucide, texte body. Remplaçant unique des
 * bandeaux ad hoc (info, succès, avertissement, danger).
 */

export type BannerTone = "info" | "success" | "warning" | "danger";

// danger s'appuie sur --destructive : aucun token --danger dans le contrat.
const toneStyles: Record<
  BannerTone,
  { surface: string; icon: string; Icon: LucideIcon }
> = {
  info: {
    surface: "bg-info/10 ring-info/25",
    icon: "text-info",
    Icon: Info,
  },
  success: {
    surface: "bg-success/10 ring-success/25",
    icon: "text-success",
    Icon: CheckCircle2,
  },
  warning: {
    surface: "bg-warning/10 ring-warning/25",
    icon: "text-warning",
    Icon: AlertTriangle,
  },
  danger: {
    surface: "bg-destructive/10 ring-destructive/25",
    icon: "text-destructive",
    Icon: AlertCircle,
  },
};

export interface BannerProps
  extends Omit<React.HTMLAttributes<HTMLDivElement>, "title"> {
  tone: BannerTone;
  /** Ligne d'accroche semibold au-dessus du corps. */
  title?: React.ReactNode;
  /** Action alignée à droite — passer un <Button> plain/tinted de petite taille. */
  action?: React.ReactNode;
  /** Affiche la croix de fermeture quand fourni. */
  onDismiss?: () => void;
}

const Banner = React.forwardRef<HTMLDivElement, BannerProps>(
  ({ tone, title, action, onDismiss, className, children, ...props }, ref) => {
    const { surface, icon, Icon } = toneStyles[tone];
    return (
      <div
        ref={ref}
        // warning/danger interrompent (alert), info/success informent (status).
        role={tone === "danger" || tone === "warning" ? "alert" : "status"}
        className={cn(
          "flex items-start gap-3 rounded-xl px-4 py-3 ring-1",
          surface,
          className
        )}
        {...props}
      >
        {/* mt-px : cale l'icône 16px sur la première ligne body (19px). */}
        <Icon size={16} aria-hidden="true" className={cn("mt-px shrink-0", icon)} />
        <div className="min-w-0 flex-1">
          {title != null && (
            <div className="text-body font-semibold text-foreground">{title}</div>
          )}
          {children != null && (
            <div
              className={cn(
                "text-body",
                title != null ? "mt-0.5 text-muted-foreground" : "text-foreground"
              )}
            >
              {children}
            </div>
          )}
        </div>
        {action != null && <div className="shrink-0">{action}</div>}
        {onDismiss && (
          <button
            type="button"
            onClick={onDismiss}
            aria-label="Fermer"
            className="shrink-0 rounded-md p-0.5 text-muted-foreground transition-colors duration-[var(--dur-fast)] ease-[var(--ease-apple)] hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <X size={14} aria-hidden="true" />
          </button>
        )}
      </div>
    );
  }
);
Banner.displayName = "Banner";

export { Banner };
