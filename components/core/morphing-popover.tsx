"use client";

import React, {
  createContext,
  useContext,
  useId,
  useState,
  useRef,
  useEffect,
  useCallback,
  isValidElement,
  cloneElement,
} from "react";
import { AnimatePresence, motion, MotionConfig, type Transition, type Variants } from "framer-motion";
import { cn } from "@/lib/utils";

/**
 * MorphingPopover — popover fluide (blur + fondu) inspiré de motion-primitives.
 * API compatible : `variants` / `transition` sur le conteneur, `asChild` sur le
 * déclencheur. Volontairement SANS layoutId partagé entre déclencheur et contenu
 * (les deux restent montés simultanément → un layout partagé sauterait) : on
 * privilégie une transition d'entrée/sortie robuste avec variants personnalisés.
 * Ferme au clic extérieur et sur Échap.
 */
const DEFAULT_TRANSITION: Transition = { type: "spring", bounce: 0.1, duration: 0.4 };
const DEFAULT_VARIANTS: Variants = {
  initial: { opacity: 0, scale: 0.96, filter: "blur(8px)", y: -4 },
  animate: { opacity: 1, scale: 1, filter: "blur(0px)", y: 0 },
  exit: { opacity: 0, scale: 0.96, filter: "blur(8px)", y: -4 },
};

type Ctx = {
  isOpen: boolean;
  open: () => void;
  close: () => void;
  toggle: () => void;
  uniqueId: string;
  variants: Variants;
};
const PopoverContext = createContext<Ctx | null>(null);
function usePopover(): Ctx {
  const c = useContext(PopoverContext);
  if (!c) throw new Error("MorphingPopover components must be used within <MorphingPopover>");
  return c;
}

export function MorphingPopover({
  children,
  transition = DEFAULT_TRANSITION,
  variants = DEFAULT_VARIANTS,
  className,
  open: controlledOpen,
  onOpenChange,
  defaultOpen = false,
}: {
  children: React.ReactNode;
  transition?: Transition;
  variants?: Variants;
  className?: string;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  defaultOpen?: boolean;
}) {
  const uniqueId = useId();
  const [uncontrolled, setUncontrolled] = useState(defaultOpen);
  const isControlled = controlledOpen !== undefined;
  const isOpen = isControlled ? controlledOpen : uncontrolled;
  const ref = useRef<HTMLDivElement>(null);

  const open = useCallback(() => {
    if (!isControlled) setUncontrolled(true);
    onOpenChange?.(true);
  }, [isControlled, onOpenChange]);
  const close = useCallback(() => {
    if (!isControlled) setUncontrolled(false);
    onOpenChange?.(false);
  }, [isControlled, onOpenChange]);
  const toggle = useCallback(() => (isOpen ? close() : open()), [isOpen, open, close]);

  useEffect(() => {
    if (!isOpen) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [isOpen, close]);

  return (
    <PopoverContext.Provider value={{ isOpen, open, close, toggle, uniqueId, variants }}>
      <MotionConfig transition={transition}>
        <div ref={ref} className={cn("relative inline-block", className)}>
          {children}
        </div>
      </MotionConfig>
    </PopoverContext.Provider>
  );
}

type TriggerProps = React.ComponentPropsWithoutRef<"button"> & { asChild?: boolean };
export const MorphingPopoverTrigger = React.forwardRef<HTMLButtonElement, TriggerProps>(
  function MorphingPopoverTrigger({ children, className, asChild = false, onClick, ...props }, ref) {
    const { toggle, isOpen, uniqueId } = usePopover();
    const handle = (e: React.MouseEvent) => {
      e.stopPropagation();
      toggle();
    };
    if (asChild && isValidElement(children)) {
      const child = children as React.ReactElement<Record<string, unknown>>;
      return cloneElement(child, {
        onClick: (e: React.MouseEvent) => {
          handle(e);
          (child.props.onClick as ((e: React.MouseEvent) => void) | undefined)?.(e);
        },
        "aria-expanded": isOpen,
        "aria-controls": `popover-content-${uniqueId}`,
      });
    }
    return (
      <button
        ref={ref}
        type="button"
        onClick={(e) => {
          handle(e);
          onClick?.(e);
        }}
        aria-expanded={isOpen}
        aria-controls={`popover-content-${uniqueId}`}
        className={className}
        {...props}
      >
        {children}
      </button>
    );
  },
);

type ContentProps = { children?: React.ReactNode; className?: string; style?: React.CSSProperties };
export const MorphingPopoverContent = React.forwardRef<HTMLDivElement, ContentProps>(
  function MorphingPopoverContent({ children, className, style }, ref) {
    const { isOpen, uniqueId, variants } = usePopover();
    return (
      <AnimatePresence>
        {isOpen && (
          <motion.div
            ref={ref}
            id={`popover-content-${uniqueId}`}
            role="dialog"
            initial="initial"
            animate="animate"
            exit="exit"
            variants={variants}
            style={style}
            className={cn(
              "absolute z-50 mt-2 overflow-hidden rounded-xl border border-border bg-popover text-popover-foreground shadow-lg outline-none",
              className,
            )}
          >
            {children}
          </motion.div>
        )}
      </AnimatePresence>
    );
  },
);
