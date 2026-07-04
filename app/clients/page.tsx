import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { ClientTable } from "@/components/ClientTable";
import { ClientsSectionTabs } from "@/components/clients/ClientsSectionTabs";
import { isLivreur } from "@/lib/permissions";

export const metadata = { title: "Clients" };

export default async function ClientsPage() {
  const session = await auth();
  if (!session) redirect("/login");
  // Le livreur accède aux fiches clients mais PAS au plan d'appel (proxy.ts) :
  // on ne lui montre pas un onglet qui rebondirait vers /livraisons.
  const livreur = await isLivreur(session);

  return (
    <div className="space-y-5 sm:space-y-6 animate-fade-up">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="kicker mb-1.5">Télévente</p>
          <h1 className="font-display text-[26px] sm:text-[34px] font-semibold text-foreground tracking-tight leading-none">
            Clients
          </h1>
          <p className="hidden md:block text-[12.5px] text-muted-foreground mt-2">
            Gérez votre base, vos contacts et les plans d&apos;appel. Import &amp; synchronisation
            SAP dans <b>Paramètres › Données · SAP</b>.
          </p>
        </div>
        {/* Section fusionnée « Clients & plan d'appel » — bascule par onglets. */}
        {!livreur && <ClientsSectionTabs />}
      </header>
      <ClientTable />
    </div>
  );
}
