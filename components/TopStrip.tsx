import { EventsBanner } from "@/components/events/EventsBanner";
import { MeteoBar } from "@/components/accueil/MeteoBar";

/**
 * Bande du haut de l'ACCUEIL (au-dessus du contenu du hub) : ÉVÉNEMENTS à
 * gauche, MÉTÉO à droite — sur la même ligne (demande utilisateur : la météo
 * s'incruste au niveau de l'événement en cours, tout en haut à droite).
 *
 * LOCALE à l'accueil depuis la refonte de la coquille : montée par
 * app/accueil/page.tsx, plus par AppLayout — l'ancienne garde « seulement sur
 * /accueil » (usePathname) est donc supprimée.
 *
 * - Bande DESKTOP uniquement (hidden sm:flex) : sur mobile (app pro), pas de
 *   chrome décoratif entre la barre du haut et le contenu.
 * - `empty:hidden` : quand ni événement ni météo ne rendent quoi que ce soit,
 *   la bande disparaît entièrement (pas de marge fantôme).
 */
export function TopStrip() {
  return (
    <div className="mb-3 sm:mb-5 hidden sm:flex items-center justify-between gap-4 empty:hidden print:hidden">
      <EventsBanner />
      <MeteoBar className="hidden lg:flex ml-auto shrink-0" />
    </div>
  );
}
