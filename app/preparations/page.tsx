import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { PreparationsAFaire } from "@/components/livraisons/PreparationsAFaire";
import { LivraisonsSectionTabs } from "@/components/livraisons/LivraisonsSectionTabs";
import { isTerrainConfined } from "@/lib/preparateur";
import { PreparateurNav } from "@/components/PreparateurNav";
import { PageHeader } from "@/components/ui/page-header";

export const metadata = { title: "Préparations à faire" };
export const dynamic = "force-dynamic";

export default async function PreparationsPage() {
  const session = await auth();
  if (!session) redirect("/login");

  return (
    <div className="space-y-6 animate-fade-up">
      {/* Nav terrain (mobile) pour les rôles confinés. */}
      {isTerrainConfined(session) && <PreparateurNav current="preparations" />}
      {/* Onglets de section « Livraisons du jour » (postes non confinés). */}
      {!isTerrainConfined(session) && <LivraisonsSectionTabs />}
      <PageHeader
        kicker="Entrepôt · charge"
        title="Préparations à faire"
        help={
          <>
            Toutes les commandes <b>pas encore préparées</b> des livraisons à venir, groupées par
            <b> date de livraison</b> (la plus proche en premier). Pour préparer une commande précise,
            passe par <b>Préparation livraisons</b>.
          </>
        }
      />
      <PreparationsAFaire />
    </div>
  );
}
