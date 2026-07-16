import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { VentesDuJour } from "@/components/livraisons/VentesDuJour";
import { isLivraisonRestricted } from "@/lib/permissions";
import { PageHeader } from "@/components/ui/page-header";

export const metadata = { title: "Ventes du jour" };
export const dynamic = "force-dynamic";

export default async function VentesDuJourPage() {
  const session = await auth();
  if (!session) redirect("/login");

  // État COMMERCIAL : les rôles restreints (préparateur verrouillé, livreur) ont
  // leur propre écran (Détail livraison) — et ne doivent pas voir les magasins
  // pas encore « mis en préparation ».
  const restricted = await isLivraisonRestricted(session);
  if (restricted) redirect("/livraisons");

  return (
    <div className="space-y-6 animate-fade-up">
      <PageHeader
        kicker="Télévente"
        title="Ventes du jour"
        help={
          <>
            Les ventes <b>saisies aujourd&apos;hui</b> (jour où la commande est rentrée),
            groupées par <b>transporteur</b>. Pour chaque BL : sa <b>date de livraison</b> et
            l&apos;avancement de la préparation (<b>Préparé</b> ✓ / <b>Départ</b> ✓).
          </>
        }
      />
      <VentesDuJour />
    </div>
  );
}
