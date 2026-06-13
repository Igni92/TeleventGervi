"use client";

import { motion, useReducedMotion } from "framer-motion";
import { DUR, EASE } from "@/lib/motion";
import { cn } from "@/lib/utils";

/**
 * Carte « surface » — DA canonique de l'app, extraite du dashboard (bento `Tile`).
 *
 * Signature visuelle harmonisée partout :
 *   - fond `bg-card`, bord `border-border`, coins `rounded-xl`
 *   - bordure d'accent GAUCHE colorée (border-l-4) optionnelle
 *   - titre en « kicker » (uppercase, tracking large, muted)
 *   - entrée fade-up douce (respecte reduced-motion)
 *
 * À utiliser à la place de l'ancien shadcn `Card` (rounded-lg + shadow) pour
 * unifier le look entre Console / Stats / Clients / Stock / Entrées / Fabrication.
 */

export type Accent = "brand" | "emerald" | "rose" | "violet" | "amber" | "sky";

const ACCENT_BORDER: Record<Accent, string> = {
  brand:   "border-l-brand-500",
  emerald: "border-l-emerald-500",
  rose:    "border-l-rose-500",
  violet:  "border-l-violet-500",
  amber:   "border-l-amber-500",
  sky:     "border-l-sky-500",
};

interface SurfaceCardProps {
  children: React.ReactNode;
  /** bordure d'accent gauche colorée (comme les tuiles du dashboard) */
  accent?: Accent;
  /** titre kicker (uppercase) en haut de la carte */
  title?: React.ReactNode;
  /** élément aligné à droite du titre (bouton, refresh…) */
  action?: React.ReactNode;
  /** icône optionnelle devant le titre */
  icon?: React.ReactNode;
  /** entrée animée (fade-up) — true par défaut */
  animate?: boolean;
  /** délai d'entrée (ms) pour une cascade entre cartes */
  delay?: number;
  className?: string;
}

export function SurfaceCard({
  children, accent, title, action, icon, animate = true, delay = 0, className,
}: SurfaceCardProps) {
  const reduce = useReducedMotion();
  const base = cn(
    "bg-card border border-border rounded-xl p-4",
    accent && `border-l-4 ${ACCENT_BORDER[accent]}`,
    className,
  );

  const header = (title || action) && (
    <div className="flex items-center justify-between gap-2 mb-3">
      {title && (
        <h3 className="flex items-center gap-1.5 text-[10.5px] uppercase tracking-[0.14em] font-semibold text-muted-foreground">
          {icon}
          {title}
        </h3>
      )}
      {action}
    </div>
  );

  if (!animate || reduce) {
    return <section className={base}>{header}{children}</section>;
  }
  return (
    <motion.section
      className={base}
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: DUR.base, ease: EASE.out, delay: delay / 1000 }}
    >
      {header}
      {children}
    </motion.section>
  );
}
