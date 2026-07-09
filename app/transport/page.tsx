import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/permissions";
import { TransportCostPanel } from "@/components/transport/TransportCostPanel";

export const metadata = { title: "Coût de transport | Gervi" };
export const dynamic = "force-dynamic";

/**
 * /transport — Calcul du COÛT DE TRANSPORT et du « prix position » (€/kg).
 *
 * La direction saisit la structure de coûts (amortissement, entretien, casse,
 * salaire livreur…) et les volumes de référence (livraisons/an, kg/an) ; le
 * transporteur notifie ses dépenses réelles (photo à l'appui). Le système en
 * dérive le prix position au kilo — reporté dans la fiche client et utilisé
 * pour la marge nette transport (console + pilotage). Ne concerne que les
 * livraisons Île-de-France : l'export est à 0, le CHR est calculé pareil.
 */
export default async function TransportPage() {
  const session = await auth();
  if (!session) redirect("/login");
  // Écriture de la structure de coûts réservée à la direction / aux admins ;
  // la notification de dépenses reste ouverte (le transporteur y déclare).
  const isManager = await requireAdmin(session);

  return (
    <div className="space-y-8 animate-fade-up">
      <header>
        <p className="kicker mb-1.5">Pilotage · logistique</p>
        <h1 className="font-display text-[34px] font-semibold text-foreground tracking-tight leading-none">
          Coût de transport
        </h1>
        <p className="hidden md:block text-[12.5px] text-muted-foreground mt-2 max-w-2xl">
          Structure de coûts de la livraison en propre (amortissement, entretien, casse,
          salaire livreur…) et dépenses du transporteur. On en dérive le <span className="font-medium text-foreground">prix position</span> (coût
          au kilo) qui sert au calcul de la marge nette transport. Île-de-France uniquement :
          l&apos;export est à 0 (transport payé par le client), le CHR est calculé de la même façon.
        </p>
      </header>

      <TransportCostPanel isManager={isManager} />
    </div>
  );
}
