import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { BonsCommandePanel } from "@/components/bons-commande/BonsCommandePanel";
import { PageHeader } from "@/components/ui/page-header";

export const metadata = { title: "Bons de commande" };
export const dynamic = "force-dynamic";

export default async function BonsCommandePage() {
  const session = await auth();
  if (!session) redirect("/login");

  return (
    <div className="space-y-6 animate-fade-up">
      <PageHeader
        kicker="Entrepôt · lots"
        title="Bons de commande"
        help={
          <>
            Les <b>précommandes</b> créent une <b>offre client</b> (devis SAP) : au jour de départ, passe-la
            en commande depuis cet onglet. Les commandes en <b>bon de commande</b> partent <b>sans lot
            automatique</b> : affecte à chaque article le lot <b>réellement en stock</b>. Une fois tous les
            lots posés, la commande quitte cet onglet.
          </>
        }
      />
      <BonsCommandePanel />
    </div>
  );
}
