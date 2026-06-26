import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { MarquesLogosPanel } from "@/components/settings/MarquesLogosPanel";

export const metadata = { title: "Marques & logos" };
export const dynamic = "force-dynamic";

export default async function MarquesPage() {
  const session = await auth();
  if (!session) redirect("/login");

  return (
    <div className="space-y-6 animate-fade-up">
      <header>
        <p className="kicker mb-1.5">Paramètres · catalogue</p>
        <h1 className="font-display text-[34px] font-semibold text-foreground tracking-tight leading-none">
          Marques &amp; logos
        </h1>
        <p className="hidden md:block text-[12.5px] text-muted-foreground mt-2 max-w-2xl">
          Associe un logo à chaque marque. Les logos sont partagés (tous les postes) et
          s&apos;affichent dans la console, entre le stock et la désignation du produit.
        </p>
      </header>
      <MarquesLogosPanel />
    </div>
  );
}
