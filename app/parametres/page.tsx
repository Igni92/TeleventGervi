import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/permissions";
import { ParametresPanel } from "@/components/settings/ParametresPanel";
import { PageHeader } from "@/components/ui/page-header";

export const metadata = { title: "Paramètres" };
export const dynamic = "force-dynamic";

export default async function ParametresPage() {
  const session = await auth();
  if (!session) redirect("/login");
  // L'import clients SAP (action sensible) n'apparaît dans Paramètres que pour un admin.
  const admin = await requireAdmin(session);
  // Identité de session : sert à mémoriser le contraste de survol PAR utilisateur.
  const userKey = session.user?.email ?? null;

  return (
    <div className="space-y-6 animate-fade-up">
      <PageHeader
        kicker="Affichage · poste"
        title="Paramètres"
        help={
          <>
            Apparence, confort de lecture, console, export des stats et administration. Chaque choix
            s&apos;applique <b>immédiatement</b> et reste mémorisé sur ce poste.
          </>
        }
      />
      {/* NB : la personnalisation de la navigation (libellés + emplacement) se
          fait EN PLACE dans la sidebar — bouton crayon en haut (admin). */}
      <ParametresPanel admin={admin} userKey={userKey} />
    </div>
  );
}
