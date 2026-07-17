import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { requireAdmin, isComptable } from "@/lib/permissions";
import { isDirection } from "@/lib/permissions";
import { isTerrainConfined } from "@/lib/preparateur";
import { PlanningPanel } from "@/components/planning/PlanningPanel";
import { PreparateurNav } from "@/components/PreparateurNav";
import { PageHeader } from "@/components/ui/page-header";

export const metadata = { title: "Planning" };
export const dynamic = "force-dynamic";

/**
 * PLANNING (congés & récup) — calendrier mensuel, accessible à TOUS :
 *   • chaque salarié voit SON calendrier avec ses compteurs (CP restants +
 *     heures de récup) au-dessus, demande ses congés et répond aux
 *     propositions de la direction (boomerang) ;
 *   • la direction a UN calendrier PAR PERSONNE + le calendrier d'ÉQUIPE,
 *     propose congés/récup au vu des compteurs, règle le solde CP annuel et
 *     le plafond de récup (au-delà → payé sur le bulletin du mois suivant).
 */
export default async function PlanningPage() {
  const session = await auth();
  if (!session) redirect("/login");
  // Le profil COMPTABLE voit le planning de toute l'équipe (lecture — les
  // validations/propositions restent gatées par isDirection côté UI et API).
  const isManager = (await requireAdmin(session)) || (await isComptable(session));
  const isDir = await isDirection(session);
  const showTerrainNav = isTerrainConfined(session);

  return (
    <div className="space-y-5 animate-fade-up">
      {showTerrainNav && <PreparateurNav current="planning" />}
      <PageHeader
        kicker="Temps de travail"
        title="Planning"
        help={
          <>
            Congés et récupérations sur un calendrier mensuel. Les compteurs (congés payés
            restants, heures de récup) sont affichés au-dessus de chaque calendrier ; chaque
            demande fait la navette : l&apos;un propose, l&apos;autre valide.
          </>
        }
      />
      <PlanningPanel isManager={isManager} isDirection={isDir} />
    </div>
  );
}
