import { cn } from "@/lib/utils";

/**
 * SectionCard — « module de télémétrie » de la FICHE CLIENT (DA « salle de signal »).
 *
 * Chrome signature : surface opaque (bg-card) coiffée d'une TOP-BAR d'accent
 * dégradée (fil rouge de toute la grille, y compris blocs `bare`), micro-grille
 * radiale très discrète en marge haute (prolonge la grille technique du fond
 * global), pastille d'icône à point lumineux (status-light), filet sous l'en-tête.
 * Lift léger au survol. Purement présentationnel : enrobe le contenu fonctionnel
 * existant — aucune logique métier.
 */

export type SectionAccent =
  | "brand" | "emerald" | "rose" | "violet" | "amber" | "sky" | "slate";

const ACCENT_CHIP: Record<SectionAccent, string> = {
  brand:   "bg-brand-500/12 text-brand-600 dark:text-brand-400 ring-brand-500/20",
  emerald: "bg-emerald-500/12 text-emerald-600 dark:text-emerald-400 ring-emerald-500/20",
  rose:    "bg-rose-500/12 text-rose-600 dark:text-rose-400 ring-rose-500/20",
  violet:  "bg-violet-500/12 text-violet-600 dark:text-violet-400 ring-violet-500/20",
  amber:   "bg-amber-500/12 text-amber-600 dark:text-amber-400 ring-amber-500/20",
  sky:     "bg-sky-500/12 text-sky-600 dark:text-sky-400 ring-sky-500/20",
  slate:   "bg-slate-500/10 text-slate-600 dark:text-slate-300 ring-slate-500/20",
};

// Tables STATIQUES (Tailwind ne génère pas les classes interpolées).
const ACCENT_BAR: Record<SectionAccent, string> = {
  brand:   "from-brand-400 to-brand-600",
  emerald: "from-emerald-400 to-emerald-500",
  rose:    "from-rose-400 to-rose-500",
  violet:  "from-violet-400 to-violet-500",
  amber:   "from-amber-400 to-amber-500",
  sky:     "from-sky-400 to-sky-500",
  slate:   "from-slate-400 to-slate-500",
};

interface SectionCardProps {
  children: React.ReactNode;
  title?: React.ReactNode;
  subtitle?: React.ReactNode;
  icon?: React.ReactNode;
  accent?: SectionAccent;
  /** élément aligné à droite de l'en-tête (bouton, info-bulle…) */
  action?: React.ReactNode;
  /** sans en-tête intégré : le composant enfant fournit son propre titre */
  bare?: boolean;
  className?: string;
  /** padding du corps — `false` pour gérer le padding soi-même (tableaux pleine largeur) */
  bodyPadding?: boolean;
}

export function SectionCard({
  children, title, subtitle, icon, accent = "brand", action,
  bare = false, className, bodyPadding = true,
}: SectionCardProps) {
  const hasHeader = !bare && (title || icon || action);

  return (
    <section
      className={cn(
        "group/section relative isolate h-full overflow-hidden rounded-2xl border border-border bg-card",
        "shadow-card transition-all duration-300 hover:-translate-y-px hover:shadow-card-hover",
        className,
      )}
    >
      {/* Top-bar d'accent — fil rouge de la grille (même en mode bare). */}
      <span
        aria-hidden
        className={cn("absolute inset-x-0 top-0 z-[1] h-[3px] bg-gradient-to-r", ACCENT_BAR[accent])}
      />
      {/* Micro-grille radiale — prolonge la grille technique du fond global,
          masquée en fondu pour ne jamais gêner la lecture des formulaires. */}
      <span
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-10 opacity-[0.45] bg-[radial-gradient(hsl(var(--foreground)/0.025)_1px,transparent_1px)] [background-size:18px_18px] [mask-image:linear-gradient(to_bottom,#000,transparent_42%)]"
      />

      {hasHeader && (
        <>
          <header className="flex items-start gap-3 px-5 pt-5">
            {icon && (
              <span
                className={cn(
                  "relative flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ring-1 [&_svg]:size-[17px]",
                  ACCENT_CHIP[accent],
                )}
              >
                {icon}
                {/* status-light : point lumineux d'accent (glow .dot-accent) */}
                <span aria-hidden className="dot-accent absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-current opacity-80" />
              </span>
            )}
            <div className="min-w-0 flex-1 pt-0.5">
              {title && (
                <h3 className="truncate text-[14.5px] font-semibold leading-tight tracking-[-0.01em] text-foreground">
                  {title}
                </h3>
              )}
              {subtitle && (
                <p className="mt-0.5 truncate text-[12px] leading-snug text-muted-foreground">
                  {subtitle}
                </p>
              )}
            </div>
            {action && <div className="shrink-0">{action}</div>}
          </header>
          <div className="mx-5 mt-4 hairline" />
        </>
      )}

      <div className={cn(bodyPadding && (bare ? "p-5" : "px-5 pb-5 pt-4"))}>
        {children}
      </div>
    </section>
  );
}
