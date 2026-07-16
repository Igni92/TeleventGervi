"use client";

import { usePathname } from "next/navigation";
import { EventsBanner } from "@/components/events/EventsBanner";
import { MeteoBar } from "@/components/accueil/MeteoBar";

/**
 * Bande du HAUT de la coquille (sous la barre mobile, au-dessus du contenu) :
 * ÉVÉNEMENTS à gauche, MÉTÉO à droite — SUR LA MÊME LIGNE (demande utilisateur :
 * la météo s'incruste au niveau de l'événement en cours, tout en haut à droite).
 *
 * - La météo n'apparaît que sur l'ACCUEIL (elle appartient à cet écran) et sur
 *   desktop (le mobile a ses tuiles) ; la bannière événements reste globale.
 * - `empty:hidden` : quand ni événement ni météo ne rendent quoi que ce soit,
 *   la bande disparaît entièrement (pas de marge fantôme).
 */
export function TopStrip() {
  const pathname = usePathname();
  const onAccueil =
    pathname === "/" || pathname === "/accueil" || !!pathname?.startsWith("/accueil/");

  return (
    <div className="mb-3 sm:mb-5 flex items-center justify-between gap-4 empty:hidden print:hidden">
      <EventsBanner />
      {onAccueil && <MeteoBar className="hidden lg:flex ml-auto shrink-0" />}
    </div>
  );
}
