"use client";

import { cn } from "@/lib/utils";

/**
 * Carte « surface » — DA canonique de l'app, extraite du dashboard (bento `Tile`).
 *
 * Signature visuelle harmonisée partout :
 *   - fond `bg-card`, bord `border-border`, coins `rounded-xl`
 *   - barre d'accent colorée optionnelle, dont la POSITION est réglable
 *     globalement (gauche par défaut · haut · bas · aucune) via l'attribut
 *     `data-accent-pos` sur <html> (Paramètres → Apparence) : la couleur est
 *     posée en inline (`--sc-accent`) et globals.css choisit le côté.
 *   - titre en « kicker » (uppercase, tracking large, muted)
 *   - entrée fade-up douce en CSS (compositeur, respecte reduced-motion via
 *     `motion-reduce:animate-none`) — plus de framer-motion : ces cartes sont
 *     montées en masse sur les dashboards, l'entrée JS faisait un pic au montage.
 */

export type Accent = "brand" | "emerald" | "rose" | "violet" | "amber" | "sky";

/** Couleur de l'accent (posée en `--sc-accent`) ; le CÔTÉ est géré par globals.css. */
const ACCENT_COLOR: Record<Accent, string> = {
  brand:   "hsl(var(--brand-500))",
  emerald: "#10b981",
  rose:    "#f43f5e",
  violet:  "#8b5cf6",
  amber:   "#f59e0b",
  sky:     "#0ea5e9",
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
  /** PLEIN ÉCRAN mobile : sous 640 px la carte s'aplatit (plus de bordures,
      de coins, d'ombre ni de barre d'accent) — le contenu est bord à bord,
      « on oublie le fond ». À combiner avec un wrapper de page qui annule
      les gouttières (`max-sm:-mx-4`…). Cf. globals.css `.sc-bleed`. */
  bleed?: boolean;
  className?: string;
}

export function SurfaceCard({
  children, accent, title, action, icon, animate = true, delay = 0, bleed = false, className,
}: SurfaceCardProps) {
  const base = cn(
    "bg-card border border-border rounded-xl p-4",
    accent && "sc-accent",
    bleed && "sc-bleed",
    animate && "animate-fade-up motion-reduce:animate-none",
    className,
  );

  const style: React.CSSProperties = {
    ...(animate && delay ? { animationDelay: `${delay}ms` } : {}),
    ...(accent ? ({ "--sc-accent": ACCENT_COLOR[accent] } as React.CSSProperties) : {}),
  };

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

  return (
    <section className={base} style={style}>
      {header}
      {children}
    </section>
  );
}
