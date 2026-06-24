import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { LivraisonDetail } from "@/components/livraisons/LivraisonDetail";

export const metadata = { title: "Détail livraison" };
export const dynamic = "force-dynamic";

export default async function LivraisonsPage() {
  const session = await auth();
  if (!session) redirect("/login");

  return <LivraisonDetail />;
}
