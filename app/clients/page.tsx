import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { ClientsDirectory } from "@/components/clients/ClientsDirectory";
import { isLivreur } from "@/lib/permissions";
import { PageHeader } from "@/components/ui/page-header";

export const metadata = { title: "Clients & plan d'appel" };
export const dynamic = "force-dynamic";

export default async function ClientsPage() {
  const session = await auth();
  if (!session) redirect("/login");
  // Le livreur consulte les fiches mais ne pilote pas le plan d'appel : liste en
  // lecture (pas d'assignation vendeur/commercial ni d'outils d'admin).
  const livreur = await isLivreur(session);

  return (
    <div className="space-y-5 sm:space-y-6 animate-fade-up">
      <PageHeader
        kicker="Télévente"
        title={<>Clients &amp; plan d&apos;appel</>}
        help={
          <>
            Votre portefeuille en une vue : recherche, assignation <b>vendeur / commercial</b>,
            retards de commande et incidents ouverts, rappels. Import &amp; synchronisation SAP dans{" "}
            <b>Paramètres › Données · SAP</b>.
          </>
        }
      />
      <ClientsDirectory canManage={!livreur} />
    </div>
  );
}
