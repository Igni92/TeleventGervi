import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { FabricationClient } from "./FabricationClient";

export const metadata = { title: "Fabrication" };
export const dynamic = "force-dynamic";

export default async function FabricationPage() {
  const session = await auth();
  if (!session) redirect("/login");
  return (
    <div className="space-y-8 animate-fade-up">
      <div>
        <p className="kicker mb-2">SAP B1 · Ordre de production</p>
        <h1 className="text-[24px] sm:text-[28px] md:text-[32px] font-bold text-foreground tracking-tight leading-none">
          Fabrication
        </h1>
        <p className="hidden md:block text-[13px] text-muted-foreground mt-3 max-w-2xl">
          Une recette dit <b>quelles familles</b> composent le produit fini
          (ex. 2 colis DECO16 = 1 myrtille + 1 groseille + 2 mûre). Au moment de
          fabriquer, tu choisis <b>l&apos;article concret</b> de chaque famille selon le
          stock — le <b>lot</b> est affecté automatiquement et tracé sur l&apos;opération.
          Tout se compte <b>en colis</b>.
        </p>
      </div>
      <FabricationClient />
    </div>
  );
}
