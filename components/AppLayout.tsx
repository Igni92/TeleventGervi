import { auth } from "@/lib/auth";
import { requireAdmin } from "@/lib/permissions";
import { isTerrainConfined } from "@/lib/preparateur";
import { Sidebar } from "@/components/Sidebar";
import { MobileTopBar } from "@/components/MobileTopBar";
import { TabBar } from "@/components/TabBar";
import { RolePreviewProvider } from "@/components/role-preview/RolePreviewProvider";
import { RolePreviewBanner } from "@/components/role-preview/RolePreviewBanner";
import { HoursValidationGate } from "@/components/effectifs/HoursValidationGate";
import { ScrollProgress } from "@/components/core/scroll-progress";
import { AssistantWidget } from "@/components/assistant/AssistantWidget";

interface AppLayoutProps {
  children: React.ReactNode;
}

/**
 * Layout applicatif — sidebar gauche + zone de contenu. La bande ÉVÉNEMENTS +
 * météo (TopStrip) n'est plus globale : elle vit sur l'ACCUEIL uniquement
 * (app/accueil/page.tsx). Le cockpit /dashboard n'utilise PAS ce layout
 * (plein écran).
 *
 * Coquille TACTILE : barre du haut (MobileTopBar) + barre d'onglets basse
 * (TabBar). La TabBar est MASQUÉE pour les rôles terrain confinés (préparateur
 * restreint, livreur, agréeur) — ils ont leur nav focalisée PreparateurNav.
 *
 * Enveloppé par RolePreviewProvider : admin/direction peuvent « voir comme » un
 * rôle (aperçu visuel de la navigation, sans changer données ni droits).
 */
export async function AppLayout({ children }: AppLayoutProps) {
  const session = await auth();
  const canPreview = await requireAdmin(session); // admin OU direction
  const terrainConfined = isTerrainConfined(session);

  return (
    <RolePreviewProvider canPreview={canPreview}>
      <div className="min-h-screen flex transition-colors duration-300">
        {/* Progression de défilement — barre fine fixée en haut du viewport. */}
        <ScrollProgress className="fixed left-0 right-0 top-0 z-[60] h-0.5 bg-brand-500" />
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
          <HoursValidationGate />
          {children}
          {/* Barre d'onglets BASSE (coquille tactile) — rend aussi son propre
              espaceur de flux pour que le bas du contenu ne soit jamais couvert. */}
          {!terrainConfined && <TabBar />}
        </main>
        {/* Assistant d'aide IA — bulle flottante (bas-droite), écrans desktop. */}
        <AssistantWidget />
      </div>
    </RolePreviewProvider>
  );
}
