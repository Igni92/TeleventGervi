import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { LivraisonDetail } from "@/components/livraisons/LivraisonDetail";
import { PreparateurNav } from "@/components/PreparateurNav";
import { isRestrictedPreparateur } from "@/lib/preparateur";

export const metadata = { title: "Détail livraison" };
export const dynamic = "force-dynamic";

export default async function LivraisonsPage() {
  const session = await auth();
  if (!session) redirect("/login");

  // Préparateur « accès restreint » : il prépare mais ne dispatche pas. Les
  // contrôles logistiques (transporteur/tournée/réf/date), « Modifier » et le
  // re-codage client sont réservés aux commerciaux et admins.
  const restricted = isRestrictedPreparateur(session.user?.email);

  return (
    <>
      {restricted && <PreparateurNav current="livraisons" />}
      <LivraisonDetail canDispatch={!restricted} />
    </>
  );
}
