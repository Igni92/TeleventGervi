import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center rounded-md px-2 py-0.5 text-[11.5px] font-semibold tracking-wide transition-colors",
  {
    variants: {
      variant: {
        default:
          "bg-brand-50 text-brand-700 ring-1 ring-brand-200/60",
        secondary:
          "bg-slate-100 text-slate-600 ring-1 ring-slate-200/80",
        destructive:
          "bg-rose-50 text-rose-700 ring-1 ring-rose-200/60",
        outline:
          "text-slate-600 ring-1 ring-slate-200",
        // Types client
        export:
          "bg-sky-50 text-sky-700 ring-1 ring-sky-200/60",
        gms:
          "bg-orange-50 text-orange-700 ring-1 ring-orange-200/60",
        chr:
          "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200/60",
        // Statuts rappel
        planifie:
          "bg-amber-50 text-amber-700 ring-1 ring-amber-200/60",
        fait:
          "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200/60",
        annule:
          "bg-slate-100 text-slate-500 ring-1 ring-slate-200/80 line-through",
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
