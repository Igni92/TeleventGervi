import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { FabricationClient } from "./FabricationClient";
import { PageHeader } from "@/components/ui/page-header";

export const metadata = { title: "Fabrication" };
export const dynamic = "force-dynamic";

export default async function FabricationPage() {
  const session = await auth();
  if (!session) redirect("/login");
  return (
    <div className="space-y-8 animate-fade-up">
      <PageHeader
        kicker="SAP B1 · Ordre de production"
        title="Fabrication"
        help={
          <>
            Une recette dit <b>quelles familles</b> composent le produit fini
            (ex. 2 colis DECO16 = 1 myrtille + 1 groseille + 2 mûre). Au moment de
            fabriquer, tu choisis <b>l&apos;article concret</b> de chaque famille selon le
            stock — le <b>lot</b> est affecté automatiquement et tracé sur l&apos;opération.
            Tout se compte <b>en colis</b>.
          </>
        }
      />
      <FabricationClient />
    </div>
  );
}
