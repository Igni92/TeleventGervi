import { auth } from "@/lib/auth";
import { redirect, notFound } from "next/navigation";
import { requireAdmin } from "@/lib/permissions";
import { isRhV2Enabled } from "@/lib/rh/flag";
import { PageHeader } from "@/components/ui/page-header";
import { HeuresTeamPanel } from "@/components/rh/HeuresTeamPanel";
import { currentIsoWeek } from "@/lib/rh/week";

export const metadata = { title: "Heures & pointages" };
export const dynamic = "force-dynamic";

/** Heures & pointages (RH V2) — remplace l'ancien onglet Effectif/Heures. Direction. */
export default async function RhHeuresPage() {
  if (!isRhV2Enabled()) notFound();
  const session = await auth();
  if (!session) redirect("/login");
  if (!(await requireAdmin(session))) redirect("/rh");
  return (
    <>
      <PageHeader kicker="RH · Direction" title="Heures & pointages" help="Feuille d'équipe par semaine, calculée par le moteur RH (badgeuse + congés + fériés)." />
      <HeuresTeamPanel initialWeek={currentIsoWeek()} />
    </>
  );
}
