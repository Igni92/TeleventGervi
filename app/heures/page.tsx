import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/permissions";
import { isTerrainConfined } from "@/lib/preparateur";
import { HeuresPanel } from "@/components/effectifs/HeuresPanel";
import { PreparateurNav } from "@/components/PreparateurNav";

export const metadata = { title: "Mes heures" };
export const dynamic = "force-dynamic";

/**
 * SAISIE DES HEURES — page personnelle, accessible à TOUS (chaque employé saisit
 * SA semaine). Séparée de « Effectifs » (/commerciaux, réservé aux managers et
 * bloqué pour les rôles terrain par le middleware) : un préparateur / livreur /
 * agréeur confiné peut ainsi enregistrer ses heures sans accéder à la gestion
 * d'équipe. Un manager y retrouve la vue équipe (état mensuel + PDF compta).
 */
export default async function HeuresPage() {
  const session = await auth();
  if (!session) redirect("/login");
  const isManager = await requireAdmin(session);
  // Nav terrain (mobile) pour les rôles confinés — sinon le préparateur resterait
  // piégé sur cette page (bouton Accueil de la barre mobile → écran bloqué).
  const showTerrainNav = isTerrainConfined(session);

  return (
    <div className="space-y-5 animate-fade-up">
      {showTerrainNav && <PreparateurNav current="heures" />}
      <header>
        <p className="kicker mb-1.5">Temps de travail</p>
        <h1 className="font-display text-[28px] sm:text-[34px] font-semibold text-foreground tracking-tight leading-none">
          Mes heures
        </h1>
        <p className="hidden md:block text-[12.5px] text-muted-foreground mt-2 max-w-2xl">
          Saisis tes heures réelles semaine par semaine (matin + après-midi). L&apos;écart au
          contrat et les majorations sont calculés automatiquement ; l&apos;état mensuel sert de
          base à la paie.
        </p>
      </header>
      <HeuresPanel isManager={isManager} />
    </div>
  );
}
