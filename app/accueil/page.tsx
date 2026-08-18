import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { AccueilHub } from "@/components/accueil/AccueilHub";
import { TopStrip } from "@/components/TopStrip";

export const metadata = { title: "Accueil" };
export const dynamic = "force-dynamic";

/**
 * Accueil — hub principal de l'application (cible de « / »).
 * KPI du jour, accès rapide aux modules, dernières commandes, alertes encours,
 * promotions en cours + récemment démarrées. Tout vit côté client (AccueilHub)
 * pour des panneaux indépendants et résilients.
 */
export default async function AccueilPage() {
  const session = await auth();
  if (!session) redirect("/login");
  return (
    <>
      {/* Bande événements + météo — locale à l'accueil depuis la refonte de la
          coquille (elle n'est plus montée par AppLayout). */}
      <TopStrip />
      <AccueilHub />
    </>
  );
}
