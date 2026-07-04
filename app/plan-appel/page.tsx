import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { PlanAppel } from "@/components/plan-appel/PlanAppel";
import { ClientsSectionTabs } from "@/components/clients/ClientsSectionTabs";

export const metadata = { title: "Plan d'appel" };
export const dynamic = "force-dynamic";

export default async function PlanAppelPage() {
  const session = await auth();
  if (!session) redirect("/login");

  return (
    <div className="space-y-6 animate-fade-up">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="kicker mb-1.5">Télévente</p>
          <h1 className="font-display text-[26px] sm:text-[34px] font-semibold text-foreground tracking-tight leading-none">
            Plan d&apos;appel
          </h1>
          <p className="hidden md:block text-[12.5px] text-muted-foreground mt-2 max-w-2xl">
            Centralise les appels : affecte chaque client à un <b>vendeur</b> (télévente) et un
            <b> commercial</b>, repère les <b>commandes en retard</b>, les <b>incidents ouverts</b>
            et les jours d&apos;appel. Synchronisation des données dans <b>Paramètres › Données · SAP</b>.
          </p>
        </div>
        {/* Section fusionnée « Clients & plan d'appel » — bascule par onglets. */}
        <ClientsSectionTabs />
      </header>
      <PlanAppel />
    </div>
  );
}
