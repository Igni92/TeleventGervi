import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { StoresReport } from "@/components/pilotage/StoresReport";

export const metadata = { title: "Palmarès des magasins" };
export const dynamic = "force-dynamic";

/**
 * /dashboard/magasins — « Palmarès des magasins » : état de rentabilité par
 * client (marge nette = marge brute − coût de livraison estimé), sur 12 mois
 * glissants. Vit sous /dashboard (mode cockpit, sans chrome app) mais, à la
 * différence des slides bento, c'est une page SCROLLABLE riche (héros + trio de
 * tête + classements + nuage de positionnement + détail triable).
 *
 * Périmètre commercial identique au reste du pilotage (scope slpName côté API).
 */
export default async function MagasinsPage() {
  const session = await auth();
  if (!session) redirect("/login");
  return <StoresReport />;
}
