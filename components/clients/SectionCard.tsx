import { cn } from "@/lib/utils";

/**
 * SectionCard — coquille de carte « premium » de la FICHE CLIENT.
 *
 * Langage visuel unifié pour tous les blocs de la fiche : surface neutre
 * (bg-card), coins doux (rounded-2xl), bord discret + ombre douce, et un
 * en-tête à pastille d'icône teintée (à la Linear / Vercel). Le titre est
 * toujours visible (≠ kicker masqué sur mobile) pour une hiérarchie nette.
 *
 * Purement présentationnel : ne porte aucune logique métier — il enrobe le
 * contenu fonctionnel existant pour homogénéiser la présentation.
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
  return (
    <section
      className={cn(
        "group/section relative h-full overflow-hidden rounded-2xl border border-border bg-card",
        "shadow-card transition-shadow duration-300 hover:shadow-card-hover",
        className,
      )}
    >
      {!bare && (title || icon || action) && (
        <header className="flex items-start gap-3 px-5 pt-5">
          {icon && (
            <span
              className={cn(
                "flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ring-1 [&_svg]:size-[17px]",
                ACCENT_CHIP[accent],
              )}
            >
              {icon}
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
      )}

      <div
        className={cn(
          bodyPadding && (bare ? "p-5" : "px-5 pb-5 pt-4"),
        )}
      >
        {children}
      </div>
    </section>
  );
}
