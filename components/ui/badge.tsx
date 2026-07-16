import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center rounded-md px-2 py-0.5 text-[11.5px] font-semibold tracking-wide transition-colors",
  {
    variants: {
      // Teintes TRANSLUCIDES (fond /12 + texte 700/300) : lisibles sur papier
      // chaud comme sur charcoal — l'ancien jeu `-50/-700` était illisible en
      // mode sombre (aucune variante dark).
      variant: {
        default:
          "bg-brand-500/12 text-brand-700 ring-1 ring-brand-500/25 dark:text-brand-300",
        secondary:
          "bg-secondary text-muted-foreground ring-1 ring-border",
        destructive:
          "bg-rose-500/12 text-rose-700 ring-1 ring-rose-500/25 dark:text-rose-300",
        outline:
          "text-muted-foreground ring-1 ring-border",
        // Types client
        export:
          "bg-sky-500/12 text-sky-700 ring-1 ring-sky-500/25 dark:text-sky-300",
        gms:
          "bg-orange-500/12 text-orange-700 ring-1 ring-orange-500/25 dark:text-orange-300",
        chr:
          "bg-emerald-500/12 text-emerald-700 ring-1 ring-emerald-500/25 dark:text-emerald-300",
        // Statuts rappel
        planifie:
          "bg-amber-500/12 text-amber-700 ring-1 ring-amber-500/25 dark:text-amber-300",
        fait:
          "bg-emerald-500/12 text-emerald-700 ring-1 ring-emerald-500/25 dark:text-emerald-300",
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
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return (
    <div className={cn(badgeVariants({ variant }), className)} {...props} />
  );
}

export { Badge, badgeVariants };
