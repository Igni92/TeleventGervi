"use client";

import { useEffect, useRef } from "react";
import { animate, useReducedMotion } from "framer-motion";
import { DUR, EASE } from "@/lib/motion";

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
 * Compteur animé (count-up) — Framer Motion.
 *
 * - Anime de l'ancienne valeur vers la nouvelle (utile quand la granularité change).
 * - Locale-aware (fr-FR) + tabular-nums pour éviter le layout shift.
 * - Respecte prefers-reduced-motion : affiche directement la valeur finale.
 *
 * (cf. ui-ux-pro-max : motion-meaning + number-tabular + reduced-motion)
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
  const reduce = useReducedMotion();
  // null = pas encore monté → on affiche la vraie valeur sans balayer depuis 0
  // (évite l'effet "0 qui grimpe" qui ressemble à un chargement / une fausse mesure).
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
    // Reduced-motion → valeur finale immédiate.
    // Premier rendu : honnête par défaut, SAUF animateOnMount (effet vitrine) sur une valeur > 0.
    if (reduce || (firstMount && !(animateOnMount && value !== 0))) {
      node.textContent = format(value);
      prev.current = value;
      return;
    }
    // Count-up : depuis 0 au montage (vitrine) ou depuis l'ancienne valeur (changement réel).
    const from = firstMount ? 0 : prev.current!;
    const controls = animate(from, value, {
      duration,
      ease: EASE.out,
      onUpdate(v) {
        node.textContent = format(v);
      },
    });
    prev.current = value;
    return () => controls.stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, decimals, prefix, suffix, compact, duration, reduce]);

  return (
    <span ref={ref} className={className} style={{ fontVariantNumeric: "tabular-nums" }}>
      {format(value)}
    </span>
  );
}
