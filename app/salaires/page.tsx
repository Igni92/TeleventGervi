import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/permissions";
import { SalairesView } from "@/components/salaires/SalairesPanel";
import { PageHeader } from "@/components/ui/page-header";

export const metadata = { title: "Éléments des salaires" };
export const dynamic = "force-dynamic";

/**
 * ÉLÉMENTS DES SALAIRES — l'onglet qui REMPLACE l'envoi du PDF compta : chaque
 * fin de mois, l'admin complète primes / 13e mois / avantages en nature /
 * remboursements de frais pour chaque salarié, puis génère et envoie le
 * document (PDF) par email au cabinet comptable.
 *
 * Accès : admin/direction UNIQUEMENT. Le cabinet comptable ne se connecte plus —
 * il reçoit les documents par mail (cf. onglet « État comptable » = liste des
 * envois).
 */
export default async function SalairesPage() {
  const session = await auth();
  if (!session) redirect("/login");
  const canEdit = await requireAdmin(session);
  if (!canEdit) redirect("/heures");

  return (
    <div className="space-y-5 animate-fade-up">
      <div className="mx-auto w-full max-w-4xl">
        <PageHeader
          kicker="Paie"
          title="Éléments des salaires"
          help={
            <>
              Deux vues : la <b>saisie du mois</b> (primes — exceptionnelles ou commerciales —, 13e
              mois proratisé à la date d&apos;entrée CDI, avantage en nature véhicule, frais) et
              l&apos;<b>état comptable</b>, le document mois par mois transmis au cabinet. Le
              récapitulatif part par email — il remplace l&apos;envoi du PDF des heures.
            </>
          }
        />
      </div>
      <SalairesView canEdit />
    </div>
  );
}
