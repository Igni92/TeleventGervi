import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { ClientTable } from "@/components/ClientTable";

export const metadata = { title: "Clients" };

export default async function ClientsPage() {
  const session = await auth();
  if (!session) redirect("/login");

  return (
    <div className="space-y-6 animate-fade-up">
      <header>
        <p className="kicker mb-1.5">Base de données</p>
        <h1 className="font-display text-[34px] font-semibold text-foreground tracking-tight leading-none">
          Clients
        </h1>
        <p className="text-[12.5px] text-muted-foreground mt-2">
          Gérez votre base, vos contacts et les plans d&apos;appel. Import &amp; synchronisation
          SAP dans <b>Paramètres › Données · SAP</b>.
        </p>
      </header>
      <ClientTable />
    </div>
  );
}
