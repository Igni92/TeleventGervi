import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { ClientsAppel } from "@/components/clients/ClientsAppel";
import { isLivreur } from "@/lib/permissions";

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
      <header>
        <p className="kicker mb-1.5">Télévente</p>
        <h1 className="font-display text-[26px] sm:text-[34px] font-semibold text-foreground tracking-tight leading-none">
          Clients &amp; plan d&apos;appel
        </h1>
        <p className="hidden md:block text-[12.5px] text-muted-foreground mt-2 max-w-2xl">
          Votre portefeuille en une vue : recherche, assignation <b>vendeur / commercial</b>,
          retards de commande et incidents ouverts, rappels. Import &amp; synchronisation SAP dans{" "}
          <b>Paramètres › Données · SAP</b>.
        </p>
      </header>
      <ClientsAppel canManage={!livreur} />
    </div>
  );
}
