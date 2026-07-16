import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { DetailsLivraisonArticles } from "@/components/livraisons/DetailsLivraisonArticles";
import { LivraisonsSectionTabs } from "@/components/livraisons/LivraisonsSectionTabs";
import { PageHeader } from "@/components/ui/page-header";

export const metadata = { title: "Détails par article" };
export const dynamic = "force-dynamic";

/**
 * /details-livraison — Récap PAR ARTICLE de tout ce qui PART le jour choisi
 * (date de LIVRAISON = DocDueDate), avec les tags produit pour identifier
 * précisément l'article, et la quantité ventilée par segment GMS / CHR / EXPORT.
 * ≠ Ventes du jour (ventes SAISIES aujourd'hui). Consultation.
 */
export default async function DetailsLivraisonPage() {
  const session = await auth();
  if (!session) redirect("/login");

  return (
    <div className="space-y-6 animate-fade-up">
      {/* Onglets de section « Livraisons du jour » — vues d'une même donnée. */}
      <LivraisonsSectionTabs />
      <PageHeader
        kicker="Entrepôt"
        title="Détails par article"
        help={
          <>
            Récap <b>par article</b> de tout ce qui <b>part le jour choisi</b> (date de livraison),
            avec les tags produit (marque · conditionnement · origine · variété) et la quantité
            ventilée par segment <b>GMS / CHR / Export</b>.
          </>
        }
      />
      <DetailsLivraisonArticles />
    </div>
  );
}
