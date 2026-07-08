import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { Manquants } from "@/components/livraisons/Manquants";

export const metadata = { title: "Manquants" };
export const dynamic = "force-dynamic";

export default async function ManquantsPage() {
  const session = await auth();
  if (!session) redirect("/login");

  return (
    <div className="space-y-6 animate-fade-up">
      <header>
        <p className="kicker mb-1.5">Entrepôt · achats</p>
        <h1 className="font-display text-[34px] font-semibold text-foreground tracking-tight leading-none">
          Manquants
        </h1>
        <p className="hidden md:block text-[12.5px] text-muted-foreground mt-2 max-w-2xl">
          Les articles des commandes du jour dont le <b>disponible SAP est négatif</b> (stock
          détenu − engagé clients, tous entrepôts confondus) : on a <b>vendu plus qu&apos;on ne
          détient</b> — <b>achat à prévoir</b>. Chaque article se déplie sur les BL touchés.
        </p>
      </header>
      <Manquants />
    </div>
  );
}
