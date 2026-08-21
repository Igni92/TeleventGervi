import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { isAgreeur, requirePreparateurOrAdmin } from "@/lib/permissions";
import { isTerrainConfined } from "@/lib/preparateur";
import { EntreesWorkspace } from "@/components/entrees/EntreesWorkspace";
import { PreparateurNav } from "@/components/PreparateurNav";

export const metadata = { title: "Entrée marchandise" };
export const dynamic = "force-dynamic";

export default async function EntreesPage() {
  const session = await auth();
  if (!session) redirect("/login");
  // L'AGRÉEUR « pur » (sans rôle de gestion) ne peut PAS créer d'entrée marchandise :
  // on masque le bouton « Nouvelle entrée » et on ne lui laisse que l'historique. La
  // création reste possible pour la préparation / l'administration.
  // NB : l'AGRÉAGE ne se fait qu'au moment de la réception d'une COMMANDE
  // FOURNISSEUR (écran Commandes fournisseurs) — ici, il est seulement AFFICHÉ.
  const agreeurOnly = (await isAgreeur(session)) && !(await requirePreparateurOrAdmin(session));
  return (
    // Mobile : plein écran app — les panneaux s'étalent d'eux-mêmes
    // (règle globale .surface-card, cf. globals.css) ; titre porté par la
    // barre du haut.
    <div className="space-y-6 sm:space-y-8 animate-fade-up max-sm:space-y-3">
      {/* Nav terrain (mobile) : l'agréeur confiné navigue entre ses écrans. */}
      {isTerrainConfined(session) && <PreparateurNav current="entrees" />}
      <EntreesWorkspace agreeurOnly={agreeurOnly} />
    </div>
  );
}
