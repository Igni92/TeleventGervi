import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { isAdmin } from "@/lib/permissions";
import { ClientTable } from "@/components/ClientTable";
import { ClientImportButton } from "@/components/clients/ClientImportButton";

export const metadata = { title: "Clients" };

export default async function ClientsPage() {
  const session = await auth();
  if (!session) redirect("/login");
  // Import SAP global (peut vider la base Client) = action admin (cf. garde serveur).
  const admin = isAdmin(session);

  return (
    <div className="space-y-6 animate-fade-up">
      <header className="flex items-start justify-between gap-4">
        <div>
          <p className="kicker mb-1.5">Base de données</p>
          <h1 className="font-display text-[34px] font-semibold text-foreground tracking-tight leading-none">
            Clients
          </h1>
          <p className="text-[12.5px] text-muted-foreground mt-2">
            Gérez votre base, vos contacts et les plans d&apos;appel.
          </p>
        </div>
        {admin && <ClientImportButton />}
      </header>
      <ClientTable />
    </div>
  );
}
