import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  [
    // `btn-ripple` : onde de survol globale (globals.css) — les <button> natifs
    // sont déjà couverts par le sélecteur `button:hover` ; la classe étend
    // l'effet aux liens rendus via asChild (<a> par Slot).
    "btn-ripple inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-xl text-[13.5px] font-medium",
    // Propriétés explicites (pas `all`) : couleurs + ombre + transform.
    "transition-[background-color,border-color,color,box-shadow,transform,filter] duration-150 ease-out",
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
    "disabled:pointer-events-none disabled:opacity-50",
    "active:scale-[0.97]",
    "[&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  ].join(" "),
  {
    variants: {
      // Variantes 100 % TOKENS (clair/sombre automatiques) — plus de slate-*
      // codé en dur qui jurait avec le papier chaud / charcoal.
      variant: {
        default:
          "bg-primary text-primary-foreground font-semibold " +
          "shadow-[0_2px_10px_hsl(var(--primary)/0.25)] " +
          "hover:brightness-105 hover:shadow-[0_4px_18px_hsl(var(--primary)/0.4)]",
        destructive:
          "bg-destructive text-destructive-foreground shadow-[0_1px_3px_hsl(var(--destructive)/0.3)] " +
          "hover:brightness-110",
        outline:
          "border border-border bg-card text-foreground shadow-xs " +
          "hover:bg-secondary hover:border-input",
        secondary:
          "bg-secondary text-secondary-foreground " +
          "hover:bg-secondary/75 hover:text-foreground",
        ghost:
          "text-muted-foreground hover:bg-secondary hover:text-foreground",
        link:
          "text-brand-600 dark:text-brand-400 underline-offset-4 hover:underline",
        success:
          "bg-emerald-600 text-white shadow-[0_1px_3px_rgba(5,150,105,0.3)] " +
          "hover:bg-emerald-700",
        warning:
          "border border-amber-300 bg-amber-50 text-amber-800 " +
          "hover:bg-amber-100 hover:border-amber-400 " +
          "dark:border-amber-500/50 dark:bg-amber-900/20 dark:text-amber-400 " +
          "dark:hover:bg-amber-900/30 dark:hover:border-amber-500",
      },
      size: {
        default: "h-9 px-4 py-2",
        sm:      "h-8 rounded-lg px-3 text-[12.5px]",
        lg:      "h-10 px-5 text-[14px]",
        xl:      "h-11 px-6 text-[14px]",
        icon:    "h-9 w-9",
        "icon-sm": "h-8 w-8 rounded-lg",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    );
  }
);
Button.displayName = "Button";

export { Button, buttonVariants };
