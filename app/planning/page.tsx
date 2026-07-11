import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/permissions";
import { isDirection } from "@/lib/permissions";
import { isTerrainConfined } from "@/lib/preparateur";
import { PlanningPanel } from "@/components/planning/PlanningPanel";
import { PreparateurNav } from "@/components/PreparateurNav";

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
  const isManager = await requireAdmin(session);
  const isDir = await isDirection(session);
  const showTerrainNav = isTerrainConfined(session);

  return (
    <div className="space-y-5 animate-fade-up">
      {showTerrainNav && <PreparateurNav current="planning" />}
      <header>
        <p className="kicker mb-1.5">Temps de travail</p>
        <h1 className="font-display text-[28px] sm:text-[34px] font-semibold text-foreground tracking-tight leading-none">
          Planning
        </h1>
        <p className="hidden md:block text-[12.5px] text-muted-foreground mt-2 max-w-2xl">
          Congés et récupérations sur un calendrier mensuel. Les compteurs (congés payés
          restants, heures de récup) sont affichés au-dessus de chaque calendrier ; chaque
          demande fait la navette : l&apos;un propose, l&apos;autre valide.
        </p>
      </header>
      <PlanningPanel isManager={isManager} isDirection={isDir} />
    </div>
  );
}
