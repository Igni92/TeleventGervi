import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/permissions";
import { ParametresPanel } from "@/components/settings/ParametresPanel";

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
      <header>
        <p className="kicker mb-1.5">Affichage · poste</p>
        <h1 className="font-display text-[34px] font-semibold text-foreground tracking-tight leading-none">
          Paramètres
        </h1>
        <p className="hidden md:block text-[12.5px] text-muted-foreground mt-2 max-w-2xl">
          Apparence, confort de lecture, console, export des stats et administration. Chaque choix
          s&apos;applique <b>immédiatement</b> et reste mémorisé sur ce poste.
        </p>
      </header>
      {/* NB : la personnalisation de la navigation (libellés + emplacement) se
          fait EN PLACE dans la sidebar — bouton crayon en haut (admin). */}
      <ParametresPanel admin={admin} userKey={userKey} />
    </div>
  );
}
