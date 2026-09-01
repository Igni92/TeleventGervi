"use client";

import { motion, useScroll, useSpring, type SpringOptions } from "framer-motion";
import type { RefObject } from "react";
import { cn } from "@/lib/utils";

/**
 * ScrollProgress — barre de progression de défilement (inspirée de
 * motion-primitives). Sans `containerRef` : suit le défilement de la fenêtre.
 * `scaleX` piloté par un ressort pour un rendu fluide. À poser en `fixed` en haut
 * de page (voir AppLayout) ou en `absolute` dans un conteneur défilable.
 */
const DEFAULT_SPRING: SpringOptions = { stiffness: 200, damping: 50, restDelta: 0.001 };

export function ScrollProgress({
  className,
  springOptions,
  containerRef,
}: {
  className?: string;
  springOptions?: SpringOptions;
  containerRef?: RefObject<HTMLElement | null>;
}) {
  const { scrollYProgress } = useScroll(
    containerRef ? { container: containerRef as RefObject<HTMLElement> } : undefined,
  );
  const scaleX = useSpring(scrollYProgress, { ...DEFAULT_SPRING, ...springOptions });

  return (
    <motion.div
      role="presentation"
      aria-hidden
      className={cn("inset-x-0 top-0 h-0.5 origin-left", className)}
      style={{ scaleX }}
    />
  );
}
