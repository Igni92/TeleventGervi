import { auth } from "@/lib/auth";
import { requireAdmin } from "@/lib/permissions";
import { Sidebar } from "@/components/Sidebar";
import { MobileTopBar } from "@/components/MobileTopBar";
import { EventsBanner } from "@/components/events/EventsBanner";
import { RolePreviewProvider } from "@/components/role-preview/RolePreviewProvider";
import { RolePreviewBanner } from "@/components/role-preview/RolePreviewBanner";
import { HoursValidationGate } from "@/components/effectifs/HoursValidationGate";

interface AppLayoutProps {
  children: React.ReactNode;
}

/**
 * Layout applicatif — sidebar gauche + zone de contenu. En tête du contenu :
 * la bannière ÉVÉNEMENTS (temps forts commerciaux de la semaine ±7 j) — elle
 * remplace l'ancien ruban promos en coin. Les promotions restent diffusées par
 * le bandeau principal (PromoBanner) sur l'accueil et l'écran de commande.
 * Le cockpit /dashboard n'utilise PAS ce layout (plein écran).
 *
 * Enveloppé par RolePreviewProvider : admin/direction peuvent « voir comme » un
 * rôle (aperçu visuel de la navigation, sans changer données ni droits).
 */
export async function AppLayout({ children }: AppLayoutProps) {
  const session = await auth();
  const canPreview = await requireAdmin(session); // admin OU direction

  return (
    <RolePreviewProvider canPreview={canPreview}>
      <div className="min-h-screen flex transition-colors duration-300">
        <Sidebar />
        {/* overflow-x-clip : garde-fou anti-débordement horizontal (notamment en
            densité « Aéré » où l'échelle rem racine augmente). Les tableaux larges
            scrollent dans leurs propres conteneurs `overflow-x-auto`, donc rien
            d'utile n'est rogné ; `clip` (≠ `hidden`) préserve la barre sticky. */}
        {/* Mobile = APP plein écran : aucune gouttière verticale (la barre du
            haut colle au bord, le contenu file jusqu'en bas). Les gouttières
            horizontales px-4 restent pour le texte hors carte — les panneaux
            (SurfaceCard/SectionCard) les annulent eux-mêmes (cf. globals.css
            « plein écran mobile »). Le confort d'écran (py) reste sur ≥ sm. */}
        <main className="flex-1 min-w-0 max-w-[1440px] mx-auto px-4 sm:px-10 lg:px-14 py-0 sm:py-8 lg:py-10 overflow-x-clip">
          {/* Interface MOBILE aussi sur TABLETTE : la bascule n'est plus seulement
              la largeur (md) mais le TYPE d'appareil — `pointer: coarse` = écran
              tactile (téléphone/tablette) → barre du haut forcée, sidebar masquée. */}
          <MobileTopBar className="md:hidden touch:!block" />
          <RolePreviewBanner />
          {/* Bannière événements : desktop uniquement — sur mobile (app pro),
              pas de chrome décoratif entre la barre du haut et le contenu. */}
          <div className="hidden sm:block"><EventsBanner /></div>
          <HoursValidationGate />
          {children}
        </main>
      </div>
    </RolePreviewProvider>
  );
}
