import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { requireAdmin, isComptable } from "@/lib/permissions";
import { SalairesPanel } from "@/components/salaires/SalairesPanel";
import { PageHeader } from "@/components/ui/page-header";

export const metadata = { title: "Éléments des salaires" };
export const dynamic = "force-dynamic";

/**
 * ÉLÉMENTS DES SALAIRES — l'onglet qui REMPLACE l'envoi du PDF compta : chaque
 * fin de mois, l'admin complète primes / 13e mois / avantages en nature /
 * remboursements de frais pour chaque salarié, puis envoie le récapitulatif
 * par email au cabinet comptable (heures travaillées, supp payées ou en récup,
 * CP, absences, fériés, primes, AN…).
 *
 * Accès : admin/direction (édition) + profil COMPTABLE compta@gervifrais.com
 * (lecture seule — il a aussi accès au planning).
 */
export default async function SalairesPage() {
  const session = await auth();
  if (!session) redirect("/login");
  const canEdit = await requireAdmin(session);
  const comptable = await isComptable(session);
  if (!canEdit && !comptable) redirect("/heures");

  return (
    <div className="space-y-5 animate-fade-up">
      <PageHeader
        kicker="Paie"
        title="Éléments des salaires"
        help={
          <>
            Par salarié et par mois : heures (reprises de la saisie), primes — exceptionnelles ou
            commerciales —, 13e mois (½ juin, ½ décembre, proratisé à la date d&apos;entrée CDI),
            avantage en nature véhicule et remboursements de frais. Le récapitulatif part par
            email au cabinet comptable — il remplace l&apos;envoi du PDF des heures.
          </>
        }
      />
      <SalairesPanel canEdit={canEdit} />
    </div>
  );
}
