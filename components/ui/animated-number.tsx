"use client";

import { useEffect, useRef } from "react";
import { DUR } from "@/lib/motion";

interface AnimatedNumberProps {
  value: number;
  /** chiffres après la virgule */
  decimals?: number;
  /** préfixe (ex. rien) / suffixe (ex. " €", " %") */
  prefix?: string;
  suffix?: string;
  /** format compact (1,2 k / 3,4 M) — pour les gros montants */
  compact?: boolean;
  /** formateur custom — prioritaire sur decimals/prefix/suffix/compact (ex. euro) */
  format?: (n: number) => string;
  /** durée du count-up (s) */
  duration?: number;
  /**
   * Anime 0→valeur dès le 1er affichage (effet "waouh" sur les écrans vitrine).
   * Par défaut false = honnête (valeur finale directe, count-up seulement sur changement).
   * Ne se déclenche jamais en reduced-motion ni si la valeur est 0.
   */
  animateOnMount?: boolean;
  className?: string;
}

/**
 * Compteur animé (count-up) — requestAnimationFrame natif (PAS framer-motion :
 * ce composant est monté en masse sur les dashboards, on évite N instances
 * framer au montage).
 *
 * - Anime de l'ancienne valeur vers la nouvelle (utile quand la granularité change).
 * - Locale-aware (fr-FR) + tabular-nums pour éviter le layout shift.
 * - Respecte prefers-reduced-motion : affiche directement la valeur finale.
 */
export function AnimatedNumber({
  value,
  decimals = 0,
  prefix = "",
  suffix = "",
  compact = false,
  format: customFormat,
  duration = DUR.slow,
  animateOnMount = false,
  className,
}: AnimatedNumberProps) {
  const ref = useRef<HTMLSpanElement>(null);
  // null = pas encore monté → on affiche la vraie valeur sans balayer depuis 0.
  const prev = useRef<number | null>(null);

  const format = (n: number) => {
    if (customFormat) return customFormat(n);
    const formatted = compact
      ? new Intl.NumberFormat("fr-FR", { notation: "compact", maximumFractionDigits: 1 }).format(n)
      : new Intl.NumberFormat("fr-FR", {
          minimumFractionDigits: decimals,
          maximumFractionDigits: decimals,
        }).format(n);
    return `${prefix}${formatted}${suffix}`;
  };

  useEffect(() => {
    const node = ref.current;
    if (!node) return;

    const firstMount = prev.current === null;
    const reduce =
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

    // Reduced-motion → valeur finale immédiate.
    // Premier rendu : honnête par défaut, SAUF animateOnMount (vitrine) sur une valeur > 0.
    if (reduce || (firstMount && !(animateOnMount && value !== 0))) {
      node.textContent = format(value);
      prev.current = value;
      return;
    }

    // Count-up rAF : depuis 0 au montage (vitrine) ou depuis l'ancienne valeur.
    const from = firstMount ? 0 : prev.current!;
    const to = value;
    const ms = Math.max(1, duration * 1000);
    const start = performance.now();
    let raf = 0;
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / ms);
      const eased = 1 - Math.pow(1 - t, 3); // easeOut cubique
      node.textContent = format(from + (to - from) * eased);
      if (t < 1) raf = requestAnimationFrame(step);
      else node.textContent = format(to);
    };
    raf = requestAnimationFrame(step);
    prev.current = value;
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, decimals, prefix, suffix, compact, duration]);

  return (
    <span ref={ref} className={className} style={{ fontVariantNumeric: "tabular-nums" }}>
      {format(value)}
    </span>
  );
}
