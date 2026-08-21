import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { isAgreeur, requirePreparateurOrAdmin } from "@/lib/permissions";
import { isTerrainConfined } from "@/lib/preparateur";
import { CommandesFournisseursWorkspace } from "@/components/entrees/CommandesFournisseursWorkspace";
import { PreparateurNav } from "@/components/PreparateurNav";

export const metadata = { title: "Cde Fournisseur" };
export const dynamic = "force-dynamic";

export default async function CommandesFournisseursPage() {
  const session = await auth();
  if (!session) redirect("/login");
  // L'AGRÉEUR « pur » (sans rôle de gestion) ne peut PAS créer de commande
  // fournisseur : on masque le bouton « Nouvelle commande ». Il conserve
  // l'historique et l'action « Réceptionner → entrée marchandise » (son seul droit).
  const agreeurOnly = (await isAgreeur(session)) && !(await requirePreparateurOrAdmin(session));
  return (
    // Mobile : plein écran app — les panneaux s'étalent d'eux-mêmes
    // (règle globale .surface-card, cf. globals.css).
    <div className="space-y-6 sm:space-y-8 animate-fade-up max-sm:space-y-3">
      {/* Nav terrain (mobile) : l'agréeur confiné navigue entre ses écrans. */}
      {isTerrainConfined(session) && <PreparateurNav current="commandes-fournisseurs" />}
      <CommandesFournisseursWorkspace agreeurOnly={agreeurOnly} />
    </div>
  );
}
