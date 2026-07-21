import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { ProspectionBoard } from "@/components/prospection/ProspectionBoard";

export const metadata = { title: "Prospection | Gervi" };
export const dynamic = "force-dynamic";

/**
 * /prospection — Pipeline CRM des prospects (GMS avec labo pâtisserie).
 *
 * Kanban 5 étapes (À contacter → Qualification → Présentation+RDV → Après 1re
 * commande → Client gagné) + Perdu. Chaque étape porte son script d'appel. Un
 * prospect travaillé reste rattaché à son commercial (prospectOwner) et bascule
 * client à l'étape GAGNE. Accès scopé : un commercial ne voit que ses prospects.
 * Cf. lib/prospection + docs/prospection-crm.md.
 */
export default async function ProspectionPage() {
  const session = await auth();
  if (!session) redirect("/login");

  return (
    <div className="h-[calc(100vh-2rem)] animate-fade-up">
      <ProspectionBoard />
    </div>
  );
}
