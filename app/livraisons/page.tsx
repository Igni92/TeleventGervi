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

  return (
    <>
      {isRestrictedPreparateur(session.user?.email) && <PreparateurNav current="livraisons" />}
      <LivraisonDetail />
    </>
  );
}
