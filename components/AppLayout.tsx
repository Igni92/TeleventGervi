import { Sidebar } from "@/components/Sidebar";
import { MobileTopBar } from "@/components/MobileTopBar";
import { EventsBanner } from "@/components/events/EventsBanner";

interface AppLayoutProps {
  children: React.ReactNode;
}

/**
 * Layout applicatif — sidebar gauche + zone de contenu. En tête du contenu :
 * la bannière ÉVÉNEMENTS (temps forts commerciaux de la semaine ±7 j) — elle
 * remplace l'ancien ruban promos en coin. Les promotions restent diffusées par
 * le bandeau principal (PromoBanner) sur l'accueil et l'écran de commande.
 * Le cockpit /dashboard n'utilise PAS ce layout (plein écran).
 */
export function AppLayout({ children }: AppLayoutProps) {
  return (
    <div className="min-h-screen flex transition-colors duration-300">
      <Sidebar />
      <main className="flex-1 min-w-0 max-w-[1440px] mx-auto px-6 sm:px-10 lg:px-14 py-4 sm:py-8 lg:py-10">
        <MobileTopBar className="md:hidden" />
        <EventsBanner />
        {children}
      </main>
    </div>
  );
}
