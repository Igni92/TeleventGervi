import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { Manquants } from "@/components/livraisons/Manquants";
import { LivraisonsSectionTabs } from "@/components/livraisons/LivraisonsSectionTabs";
import { PageHeader } from "@/components/ui/page-header";

export const metadata = { title: "Manquants" };
export const dynamic = "force-dynamic";

export default async function ManquantsPage() {
  const session = await auth();
  if (!session) redirect("/login");

  return (
    <div className="space-y-6 animate-fade-up">
      {/* Onglets de section « Livraisons du jour » — vues d'une même donnée. */}
      <LivraisonsSectionTabs />
      <PageHeader
        kicker="Entrepôt · achats"
        title="Manquants"
        help={
          <>
            On <b>sert d&apos;abord avec le stock détenu</b>, puis on <b>achète le reliquat</b>.
            Un article apparaît quand la <b>demande du jour dépasse le stock physique</b> (tous
            entrepôts) : seul le <b>déficit réel</b> est « à acheter ». Chaque article se déplie
            pour répartir le stock entre les commandes — les <b>flèches</b> choisissent qui est
            prioritaire (servi en premier).
          </>
        }
      />
      <Manquants />
    </div>
  );
}
