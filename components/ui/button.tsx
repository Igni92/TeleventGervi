import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  [
    "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-xl text-[13.5px] font-medium",
    "transition-all duration-150 ease-smooth",
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
    "disabled:pointer-events-none disabled:opacity-50",
    "active:scale-[0.97]",
    "[&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  ].join(" "),
  {
    variants: {
      variant: {
        default:
          "bg-primary text-primary-foreground font-semibold " +
          "shadow-[0_2px_10px_rgba(250,204,21,0.25)] " +
          "hover:brightness-105 hover:shadow-[0_4px_18px_rgba(250,204,21,0.4)]",
        destructive:
          "bg-rose-600 text-white shadow-[0_1px_3px_rgba(225,29,72,0.3)] " +
          "hover:bg-rose-700",
        outline:
          "border border-slate-200 bg-white text-slate-700 shadow-xs " +
          "hover:bg-slate-50 hover:border-slate-300 hover:text-slate-900 " +
          "dark:border-slate-700 dark:bg-transparent dark:text-slate-300 " +
          "dark:hover:bg-slate-800 dark:hover:border-slate-600 dark:hover:text-slate-100",
        secondary:
          "bg-slate-100 text-slate-700 " +
          "hover:bg-slate-200 hover:text-slate-900 " +
          "dark:bg-slate-800 dark:text-slate-300 " +
          "dark:hover:bg-slate-700 dark:hover:text-slate-100",
        ghost:
          "text-slate-600 hover:bg-slate-100 hover:text-slate-900 " +
          "dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100",
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
