import { InfoHint } from "./info-hint";
import { cn } from "@/lib/utils";

/**
 * <PageHeader /> — en-tête de page UNIQUE pour toute l'app.
 *
 * Remplace les 4 patterns concurrents de <h1> (26/28/32/34px, semibold/bold/
 * light, avec/sans font-display) par une seule voix : titre héros en
 * font-display (Space Grotesk), BLANC, grand. L'explication de la page
 * (ancien sous-titre gris `hidden md:block`) passe derrière un « ? » cerclé —
 * visible au survol sur desktop, supprimée sur mobile.
 *
 *   <PageHeader
 *     kicker="Télévente"
 *     title="Clients"
 *     help={<>Fiches clients, <b>tournées</b> et coordonnées.</>}
 *     actions={<Button>Nouveau client</Button>}
 *   />
 */
export function PageHeader({
  title,
  kicker,
  help,
  helpLabel = "À propos de cette page",
  actions,
  className,
}: {
  title: React.ReactNode;
  /** Eyebrow uppercase au-dessus du titre (déjà masqué < 768px via .kicker). */
  kicker?: string;
  /** Explication de la page — derrière le « ? » (ex-sous-titre gris). */
  help?: React.ReactNode;
  helpLabel?: string;
  /** Zone d'actions à droite (boutons, filtres…). */
  actions?: React.ReactNode;
  className?: string;
}) {
  // MOBILE (app pro) : le titre de page est DÉJÀ porté par la barre du haut
  // → on ne l'affiche jamais en double sous 640 px. S'il y a des actions,
  // seule leur rangée reste visible ; sinon l'en-tête disparaît entièrement.
  return (
    <header
      className={cn(
        "flex items-end justify-between gap-3 flex-wrap",
        !actions && "max-sm:hidden",
        className,
      )}
    >
      <div className="min-w-0 max-sm:hidden">
        {kicker && <p className="kicker mb-1.5">{kicker}</p>}
        <h1 className="font-display text-[27px] sm:text-[34px] font-bold tracking-tight leading-none text-foreground flex items-center gap-2.5">
          <span className="truncate">{title}</span>
          {help && (
            <InfoHint label={helpLabel} side="bottom" size={18} className="translate-y-[1px]">
              {help}
            </InfoHint>
          )}
        </h1>
      </div>
      {actions && <div className="flex items-center gap-2 shrink-0 max-sm:w-full max-sm:justify-end">{actions}</div>}
    </header>
  );
}
