import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { SEGMENT_BADGE } from "@/lib/segments";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  // Pilule translucide : fond /12 + liseré /25, lisible clair/sombre.
  "inline-flex items-center whitespace-nowrap rounded-full px-2.5 py-0.5 text-[11px] font-semibold transition-colors",
  {
    variants: {
      variant: {
        default:
          "bg-brand-500/12 text-brand-700 dark:text-brand-300 ring-1 ring-brand-500/25",
        secondary:
          "bg-secondary text-muted-foreground ring-1 ring-border",
        destructive:
          "bg-destructive/12 text-destructive ring-1 ring-destructive/25",
        outline:
          "text-muted-foreground ring-1 ring-border",
        // Types client — couleurs canoniques importées de lib/segments.ts
        // (vérité unique) : GMS = teal · CHR = amber · EXPORT = violet.
        export: SEGMENT_BADGE.EXPORT,
        gms:    SEGMENT_BADGE.GMS,
        chr:    SEGMENT_BADGE.CHR,
        // Statuts rappel — tokens sémantiques (basculent seuls clair/sombre).
        planifie:
          "bg-warning/12 text-warning ring-1 ring-warning/25",
        fait:
          "bg-success/12 text-success ring-1 ring-success/25",
        annule:
          "bg-secondary text-muted-foreground/70 ring-1 ring-border line-through",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return (
    <span className={cn(badgeVariants({ variant }), className)} {...props} />
  );
}

export { Badge, badgeVariants };
