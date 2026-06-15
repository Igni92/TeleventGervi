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

  return (
    <div className="space-y-6 animate-fade-up">
      <header>
        <p className="kicker mb-1.5">Affichage · poste</p>
        <h1 className="font-display text-[34px] font-semibold text-foreground tracking-tight leading-none">
          Paramètres
        </h1>
        <p className="text-[12.5px] text-muted-foreground mt-2 max-w-2xl">
          Réglages d&apos;affichage de l&apos;application — thème, colorimétrie, densité,
          animations et bandeau promotions. Chaque choix s&apos;applique <b>immédiatement</b> et
          reste mémorisé sur ce poste.
        </p>
      </header>
      <ParametresPanel admin={admin} />
    </div>
  );
}
