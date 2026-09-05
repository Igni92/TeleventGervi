import { auth } from "@/lib/auth";
import { redirect, notFound } from "next/navigation";
import { requireAdmin } from "@/lib/permissions";
import { isRhV2Enabled } from "@/lib/rh/flag";
import { PageHeader } from "@/components/ui/page-header";
import { DirectionCockpit } from "@/components/rh/DirectionCockpit";
import { ContractsPanel } from "@/components/rh/ContractsPanel";

export const metadata = { title: "Cockpit RH & contrats" };
export const dynamic = "force-dynamic";

/** Cockpit RH direction (RH V2) — présence temps réel + gestion des contrats et
 *  saisonniers, réunis sur une seule page. Réservé admin/direction. */
export default async function RhDirectionPage() {
  if (!isRhV2Enabled()) notFound();
  const session = await auth();
  if (!session) redirect("/login");
  if (!(await requireAdmin(session))) redirect("/rh");
  return (
    <>
      <PageHeader kicker="RH · Direction" title="Cockpit RH & contrats" help="Présence en temps réel (badgeuse), échéances de contrat, congés à valider — et gestion des contrats & saisonniers." />
      <DirectionCockpit />
      <section className="mt-8">
        <h2 className="text-[15px] font-semibold text-foreground mb-3">Contrats & saisonniers</h2>
        <ContractsPanel />
      </section>
    </>
  );
}
