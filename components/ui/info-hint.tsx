"use client";

import * as React from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";

/**
 * <InfoHint /> — pictogramme « ? » cerclé pour l'info SECONDAIRE.
 *
 * Règle de hiérarchie (DA) : l'écran n'affiche en clair que l'essentiel
 * (blanc/jaune, grand) ; les détails et métadonnées vivent derrière ce « ? »
 * et n'apparaissent qu'au survol (ou au focus clavier).
 *
 *   <InfoHint label="Référence SAP">DOC-142857 · créé le 12/07 08:14</InfoHint>
 *
 * Mobile : l'info secondaire est SUPPRIMÉE (demande client) — le composant
 * est masqué en dessous de `sm` et sur coquille tactile (`touch:hidden`),
 * sauf `keepOnMobile`. Le tooltip est rendu en portal (jamais rogné par un
 * overflow parent), origine côté déclencheur, entrée 150 ms ease-out.
 */

type Side = "top" | "bottom" | "left" | "right";

interface InfoHintProps {
  /** Contenu affiché dans la bulle (l'info secondaire elle-même). */
  children: React.ReactNode;
  /** Petit intitulé uppercase au-dessus du contenu (ex. « Référence »). */
  label?: string;
  side?: Side;
  /** Par défaut le « ? » disparaît sur mobile/tactile ; true pour le garder. */
  keepOnMobile?: boolean;
  className?: string;
  /** Taille du rond (px). 16 par défaut — discret à côté du texte. */
  size?: number;
}

export function InfoHint({
  children,
  label,
  side = "top",
  keepOnMobile = false,
  className,
  size = 16,
}: InfoHintProps) {
  const [open, setOpen] = React.useState(false);
  const [pos, setPos] = React.useState<{ x: number; y: number } | null>(null);
  const ref = React.useRef<HTMLButtonElement>(null);
  const timer = React.useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const computePos = React.useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const margin = 8;
    let x = 0,
      y = 0;
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
    }, 150);
  };
  const hide = () => {
    clearTimeout(timer.current);
    setOpen(false);
  };

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

  return (
    <>
      <button
        type="button"
        ref={ref}
        tabIndex={0}
        aria-label={label ?? "Détails"}
        className={cn(
          "inline-flex items-center justify-center shrink-0 align-middle cursor-help select-none",
          "rounded-full border border-border/90 bg-transparent",
          "text-muted-foreground/70 hover:text-foreground hover:border-foreground/40",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          "transition-colors duration-150",
          // Mobile / tactile : l'info secondaire disparaît purement et simplement.
          !keepOnMobile && "hidden sm:inline-flex touch:hidden",
          className,
        )}
        style={{ width: size, height: size, fontSize: Math.round(size * 0.62) }}
        onMouseEnter={show}
        onMouseLeave={hide}
        onFocus={show}
        onBlur={hide}
        onClick={(e) => e.preventDefault()}
      >
        <span className="font-semibold leading-none" aria-hidden>?</span>
      </button>
      {open && pos && (
        <HintPortal pos={pos} side={side} label={label}>
          {children}
        </HintPortal>
      )}
    </>
  );
}

function HintPortal({
  pos,
  side,
  label,
  children,
}: {
  pos: { x: number; y: number };
  side: Side;
  label?: string;
  children: React.ReactNode;
}) {
  const [mounted, setMounted] = React.useState(false);
  React.useEffect(() => setMounted(true), []);
  if (!mounted) return null;

  const translate =
    side === "top"    ? "translate(-50%, -100%)" :
    side === "bottom" ? "translate(-50%, 0)" :
    side === "left"   ? "translate(-100%, -50%)" :
                        "translate(0, -50%)";

  return createPortal(
    <div
      role="tooltip"
      className={cn(
        "fixed z-[100] pointer-events-none w-max max-w-[300px]",
        "px-3.5 py-2.5 rounded-xl text-[12.5px] leading-relaxed",
        "bg-popover text-popover-foreground border border-border shadow-modal",
        "animate-scale-in motion-reduce:animate-none",
      )}
      style={{ left: pos.x, top: pos.y, transform: translate }}
    >
      {label && (
        <span className="block text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground mb-1">
          {label}
        </span>
      )}
      <span className="block">{children}</span>
    </div>,
    document.body,
  );
}
