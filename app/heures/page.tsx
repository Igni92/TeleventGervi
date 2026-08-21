import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import Link from "next/link";
import { Palmtree, ChevronRight } from "lucide-react";
import { requireAdmin } from "@/lib/permissions";
import { isTerrainConfined } from "@/lib/preparateur";
import { HeuresPanel } from "@/components/effectifs/HeuresPanel";
import { PreparateurNav } from "@/components/PreparateurNav";
import { PageHeader } from "@/components/ui/page-header";

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
      <PageHeader
        kicker="Temps de travail"
        title="Mes heures"
        help={
          <>
            Saisis tes heures réelles semaine par semaine (matin + après-midi). L&apos;écart au
            contrat et les majorations sont calculés automatiquement ; l&apos;état mensuel sert de
            base à la paie.
          </>
        }
      />
      <HeuresPanel isManager={isManager} />

      {/* CIRCUIT CONGÉS UNIQUE : la demande et le suivi se font désormais sur le
          Planning (calendrier + boomerang de validation). Ici, un simple renvoi. */}
      <Link
        href="/planning"
        className="group flex items-center gap-3 rounded-xl border border-border bg-card px-4 py-3 shadow-card transition-colors hover:bg-secondary/60"
      >
        <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-secondary text-muted-foreground">
          <Palmtree className="h-4 w-4" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-body font-semibold text-foreground">Poser un congé</span>
          <span className="block text-caption text-muted-foreground">
            Congés et récupérations se gèrent sur le calendrier du Planning.
          </span>
        </span>
        <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
      </Link>
    </div>
  );
}
