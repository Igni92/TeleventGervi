import { cn } from "@/lib/utils";

/**
 * SectionCard — conteneur de section de la FICHE CLIENT.
 *
 * Un seul langage : surface sobre (bg-card), en-tête par TITRE en texte +
 * hairline, icône neutre. Plus d'accents colorés arbitraires ni de chrome
 * décoratif (top-bar dégradée, micro-grille, point lumineux, lift au survol) :
 * la couleur ne code plus l'identité de section. Les zones de saisie /
 * formulaires restent lisibles sur fond neutre. Purement présentationnel :
 * enrobe le contenu fonctionnel existant.
 */

// Le type `accent` est conservé pour compatibilité des appelants, mais n'a plus
// d'effet visuel : toutes les sections partagent le même traitement neutre.
export type SectionAccent =
  | "brand" | "emerald" | "rose" | "violet" | "amber" | "sky" | "slate";

interface SectionCardProps {
  children: React.ReactNode;
  title?: React.ReactNode;
  subtitle?: React.ReactNode;
  icon?: React.ReactNode;
  /** Conservé pour compatibilité — sans effet visuel (langage unifié). */
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
  children, title, subtitle, icon, action,
  bare = false, className, bodyPadding = true,
}: SectionCardProps) {
  const hasHeader = !bare && (title || icon || action);

  return (
    <section
      className={cn(
        // `surface-card` : plein écran mobile global (bord à bord, sans cadre) ;
        // le cadre « carte » reste sur ≥ sm.
        "surface-card h-full overflow-hidden rounded-2xl border border-border bg-card shadow-card",
        className,
      )}
    >
      {hasHeader && (
        <>
          <header className="flex items-start gap-3 px-5 pt-5">
            {icon && (
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-secondary text-muted-foreground ring-1 ring-border [&_svg]:size-[17px]">
                {icon}
              </span>
            )}
            <div className="min-w-0 flex-1 pt-0.5">
              {title && (
                <h3 className="truncate text-callout font-semibold text-foreground">
                  {title}
                </h3>
              )}
              {subtitle && (
                <p className="mt-0.5 truncate text-caption text-muted-foreground">
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
