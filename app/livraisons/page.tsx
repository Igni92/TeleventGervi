import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { LivraisonDetail } from "@/components/livraisons/LivraisonDetail";
import { PreparateurNav } from "@/components/PreparateurNav";
import { isRestrictedPreparateur } from "@/lib/preparateur";
import { isLivreur } from "@/lib/permissions";

export const metadata = { title: "Détail livraison" };
export const dynamic = "force-dynamic";

export default async function LivraisonsPage() {
  const session = await auth();
  if (!session) redirect("/login");

  // Rôles à ACCÈS RESTREINT (préparateur, livreur) : ils préparent / livrent mais
  // ne dispatchent pas. Les contrôles logistiques (transporteur/tournée/réf/date),
  // « Modifier » et le re-codage client sont réservés aux commerciaux et admins.
  const preparateur = isRestrictedPreparateur(session.user?.email);
  const livreur = await isLivreur(session);
  const restricted = preparateur || livreur;

  return (
    <>
      {restricted && <PreparateurNav current="livraisons" />}
      <LivraisonDetail canDispatch={!restricted} />
    </>
  );
}
