"use client";

import * as React from "react";
import { createPortal } from "react-dom";
import { Info } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * <InfoTip /> — lightweight tooltip for explaining metrics/terms.
 *
 * Rendered via a portal so it never gets clipped by parent overflow.
 * Usage:
 *
 *   1. Standalone "i" icon:
 *      <InfoTip label="Conversion" content="commandes / appels" />
 *
 *   2. Wrap any element:
 *      <InfoTip label="Restants" content="..."><span>12</span></InfoTip>
 */
type Side = "top" | "bottom" | "left" | "right";

interface InfoTipProps {
  children?: React.ReactNode;
  content?: React.ReactNode;
  label?: string;
  side?: Side;
  className?: string;
  iconSize?: number;
}

export function InfoTip({
  children,
  content,
  label,
  side = "top",
  className,
  iconSize = 12,
}: InfoTipProps) {
  const [open, setOpen] = React.useState(false);
  const [pos, setPos] = React.useState<{ x: number; y: number } | null>(null);
  const ref = React.useRef<HTMLSpanElement>(null);
  const timer = React.useRef<NodeJS.Timeout | undefined>(undefined);

  const computePos = React.useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const margin = 10;
    let x = 0, y = 0;
    switch (side) {
      case "top":    x = r.left + r.width / 2; y = r.top - margin; break;
      case "bottom": x = r.left + r.width / 2; y = r.bottom + margin; break;
      case "left":   x = r.left - margin;      y = r.top + r.height / 2; break;
      case "right":  x = r.right + margin;     y = r.top + r.height / 2; break;
    }
    setPos({ x, y });
  }, [side]);

  const show = () => {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      computePos();
      setOpen(true);
    }, 180);
  };
  const hide = () => {
    clearTimeout(timer.current);
    setOpen(false);
  };

  // Reposition on scroll/resize while open
  React.useEffect(() => {
    if (!open) return;
    const onUpdate = () => computePos();
    window.addEventListener("scroll", onUpdate, true);
    window.addEventListener("resize", onUpdate);
    return () => {
      window.removeEventListener("scroll", onUpdate, true);
      window.removeEventListener("resize", onUpdate);
    };
  }, [open, computePos]);

  // Wrap mode: pass children as trigger + content as tip body
  // Icon mode: no children → render built-in "i" icon, content as tip body
  const isWrap = children !== undefined && React.Children.count(children) > 0;
  const tipBody = content;

  if (isWrap) {
    return (
      <>
        <span
          ref={ref}
          className={cn("relative inline-flex items-center", className)}
          onMouseEnter={show}
          onMouseLeave={hide}
          onFocus={show}
          onBlur={hide}
        >
          {children}
        </span>
        {open && pos && <Portal pos={pos} side={side} label={label} body={tipBody} />}
      </>
    );
  }

  // Icon mode (standalone "i")
  return (
    <>
      <span
        ref={ref}
        className={cn("relative inline-flex items-center cursor-help align-middle", className)}
        tabIndex={0}
        role="button"
        aria-label={label ?? "Info"}
        onMouseEnter={show}
        onMouseLeave={hide}
        onFocus={show}
        onBlur={hide}
      >
        <Info
          className="text-muted-foreground/45 hover:text-foreground/80 transition-colors"
          style={{ width: iconSize, height: iconSize }}
        />
      </span>
      {open && pos && <Portal pos={pos} side={side} label={label} body={tipBody} />}
    </>
  );
}

function Portal({
  pos, side, label, body,
}: {
  pos: { x: number; y: number };
  side: Side;
  label?: string;
  body: React.ReactNode;
}) {
  const [mounted, setMounted] = React.useState(false);
  React.useEffect(() => { setMounted(true); }, []);
  if (!mounted) return null;

  // Translate origin per side
  const translate =
    side === "top"    ? "translate(-50%, -100%)" :
    side === "bottom" ? "translate(-50%, 0)" :
    side === "left"   ? "translate(-100%, -50%)" :
                        "translate(0, -50%)";

  return createPortal(
    <div
      role="tooltip"
      className={cn(
        "fixed z-[100] pointer-events-none w-max max-w-[280px]",
        "px-3 py-2 rounded-lg text-[12px] leading-snug",
        "bg-popover text-popover-foreground border border-border shadow-modal",
        "animate-fade-in",
      )}
      style={{
        left: pos.x,
        top: pos.y,
        transform: translate,
      }}
    >
      {label && (
        <span className="block text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground mb-1">
          {label}
        </span>
      )}
      <span className="block text-foreground">{body}</span>
    </div>,
    document.body,
  );
}
