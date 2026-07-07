import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { BonsCommandePanel } from "@/components/bons-commande/BonsCommandePanel";

export const metadata = { title: "Bons de commande" };
export const dynamic = "force-dynamic";

export default async function BonsCommandePage() {
  const session = await auth();
  if (!session) redirect("/login");

  return (
    <div className="space-y-6 animate-fade-up">
      <header>
        <p className="kicker mb-1.5">Entrepôt · lots</p>
        <h1 className="font-display text-[28px] sm:text-[34px] font-semibold text-foreground tracking-tight leading-none">
          Bons de commande
        </h1>
        <p className="hidden md:block text-[12.5px] text-muted-foreground mt-2 max-w-2xl">
          Les commandes créées en <b>bon de commande</b> (précommandes, export, ou choix manuel) partent
          <b> sans lot automatique</b> : ici, affecte à chaque article le lot <b>réellement en stock</b>.
          Une fois tous les lots posés, la commande quitte cet onglet.
        </p>
      </header>
      <BonsCommandePanel />
    </div>
  );
}
