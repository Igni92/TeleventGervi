import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  [
    // Hiérarchie UIKit : aplat / teinté / plain / outline — rayon UNIQUE 10px,
    // aucune ombre portée, seul retour tactile : active:scale.
    "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-lg text-body font-semibold",
    "transition-[background-color,border-color,color,transform] duration-[var(--dur-fast)] ease-[var(--ease-apple)]",
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
    "disabled:pointer-events-none disabled:opacity-50",
    "active:scale-[0.97]",
    "[&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  ].join(" "),
  {
    variants: {
      // 100 % TOKENS (clair/sombre et skins automatiques).
      variant: {
        // filled : aplat or Gervifrais — le survol ASSOMBRIT légèrement
        // (color-mix vers le noir), jamais de brightness ni d'ombre.
        default:
          "bg-primary text-primary-foreground " +
          "hover:bg-[color-mix(in_srgb,hsl(var(--primary))_92%,black)]",
        // tinted : accent translucide, l'étage sous filled.
        tinted:
          "bg-primary/12 text-foreground hover:bg-primary/20",
        destructive:
          "bg-destructive text-destructive-foreground " +
          "hover:bg-[color-mix(in_srgb,hsl(var(--destructive))_92%,black)]",
        // outline : carte + filet demi-pixel.
        outline:
          "border-[length:var(--hairline)] border-border bg-card text-foreground " +
          "hover:bg-secondary",
        secondary:
          "bg-secondary text-secondary-foreground hover:bg-secondary/75 hover:text-foreground",
        ghost:
          "text-muted-foreground hover:bg-secondary hover:text-foreground",
        link:
          "text-brand-600 dark:text-brand-400 underline-offset-4 hover:underline",
        // Statuts sémantiques — mêmes tokens que les badges (--success/--warning).
        success:
          "bg-success text-white " +
          "hover:bg-[color-mix(in_srgb,hsl(var(--success))_92%,black)]",
        warning:
          "bg-warning/15 text-foreground hover:bg-warning/25",
      },
      // Rayon hérité de la base (10px partout) — plus d'override par taille.
      size: {
        default: "h-9 px-4",
        sm:      "h-8 px-3 text-caption",
        lg:      "h-10 px-5 text-callout",
        xl:      "h-11 px-6 text-callout",
        icon:    "h-9 w-9",
        "icon-sm": "h-8 w-8",
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
