import { Sidebar } from "@/components/Sidebar";
import { PromoRibbon } from "@/components/promos/PromoRibbon";

interface AppLayoutProps {
  children: React.ReactNode;
}

/**
 * Layout applicatif — sidebar gauche (remplace l'ancienne Navbar horizontale,
 * conservée dans components/Navbar.tsx pour rollback) + zone de contenu.
 * Le cockpit /dashboard n'utilise PAS ce layout (plein écran).
 */
export function AppLayout({ children }: AppLayoutProps) {
  return (
    <div className="min-h-screen flex transition-colors duration-300">
      <Sidebar />
      <main className="flex-1 min-w-0 max-w-[1440px] mx-auto px-6 sm:px-10 lg:px-14 py-8 lg:py-10">
        {children}
      </main>
      {/* Ruban promos « en biais » — coin haut-droit, global (null si aucune promo). */}
      <PromoRibbon />
    </div>
  );
}
