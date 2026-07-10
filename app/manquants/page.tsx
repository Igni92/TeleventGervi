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
          On <b>sert d&apos;abord avec le stock détenu</b>, puis on <b>achète le reliquat</b>.
          Un article apparaît quand la <b>demande du jour dépasse le stock physique</b> (tous
          entrepôts) : seul le <b>déficit réel</b> est « à acheter ». Chaque article se déplie
          pour répartir le stock entre les commandes — les <b>flèches</b> choisissent qui est
          prioritaire (servi en premier).
        </p>
      </header>
      <Manquants />
    </div>
  );
}
