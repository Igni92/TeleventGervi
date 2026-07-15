import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { LivraisonDetail } from "@/components/livraisons/LivraisonDetail";
import { LivraisonsSectionTabs } from "@/components/livraisons/LivraisonsSectionTabs";
import { PreparateurNav } from "@/components/PreparateurNav";
import { isTerrainConfined } from "@/lib/preparateur";
import { isLivraisonRestricted } from "@/lib/permissions";

export const metadata = { title: "Livraisons du jour" };
export const dynamic = "force-dynamic";

export default async function LivraisonsPage() {
  const session = await auth();
  if (!session) redirect("/login");

  // Rôles à ACCÈS RESTREINT (préparateur, livreur) : ils préparent / livrent mais
  // ne dispatchent pas. Les contrôles logistiques (transporteur/tournée/réf/date),
  // « Modifier » et le re-codage client sont réservés aux commerciaux et admins.
  // Un rôle élevé (admin / direction / commercial) qui porte aussi un flag terrain
  // garde l'accès complet (voit tout + peut mettre en prépa) — cf. isLivraisonRestricted.
  const restricted = await isLivraisonRestricted(session);

  return (
    <>
      {isTerrainConfined(session) && <PreparateurNav current="livraisons" />}
      {/* Onglets de section « Livraisons du jour » — masqués aux rôles terrain
          confinés (ils utilisent PreparateurNav ci-dessus). */}
      {!isTerrainConfined(session) && (
        <div className="mb-4">
          <LivraisonsSectionTabs />
        </div>
      )}
      <LivraisonDetail canDispatch={!restricted} />
    </>
  );
}
