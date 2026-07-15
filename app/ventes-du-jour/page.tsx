import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { VentesDuJour } from "@/components/livraisons/VentesDuJour";
import { isLivraisonRestricted } from "@/lib/permissions";

export const metadata = { title: "Ventes du jour" };
export const dynamic = "force-dynamic";

export default async function VentesDuJourPage() {
  const session = await auth();
  if (!session) redirect("/login");

  // État COMMERCIAL : les rôles restreints (préparateur verrouillé, livreur) ont
  // leur propre écran (Détail livraison) — et ne doivent pas voir les magasins
  // pas encore « mis en préparation ».
  const restricted = await isLivraisonRestricted(session);
  if (restricted) redirect("/livraisons");

  return (
    <div className="space-y-6 animate-fade-up">
      <header>
        <p className="kicker mb-1.5">Télévente</p>
        <h1 className="font-display text-[34px] font-semibold text-foreground tracking-tight leading-none">
          Ventes du jour
        </h1>
        <p className="hidden md:block text-[12.5px] text-muted-foreground mt-2 max-w-2xl">
          Les ventes <b>saisies aujourd&apos;hui</b> (jour où la commande est rentrée),
          groupées par <b>transporteur</b>. Pour chaque BL : sa <b>date de livraison</b> et
          l&apos;avancement de la préparation (<b>Préparé</b> ✓ / <b>Départ</b> ✓).
        </p>
      </header>
      <VentesDuJour />
    </div>
  );
}
