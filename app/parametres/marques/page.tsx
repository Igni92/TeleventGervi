import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { MarquesLogosPanel } from "@/components/settings/MarquesLogosPanel";
import { PageHeader } from "@/components/ui/page-header";

export const metadata = { title: "Marques & logos" };
export const dynamic = "force-dynamic";

export default async function MarquesPage() {
  const session = await auth();
  if (!session) redirect("/login");

  return (
    <div className="space-y-6 animate-fade-up">
      <PageHeader
        kicker="Paramètres · catalogue"
        title={<>Marques &amp; logos</>}
        help={
          <>
            Associe un logo à chaque marque. Les logos sont partagés (tous les postes) et
            s&apos;affichent dans la console, entre le stock et la désignation du produit.
          </>
        }
      />
      <MarquesLogosPanel />
    </div>
  );
}
