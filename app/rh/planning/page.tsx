import { auth } from "@/lib/auth";
import { redirect, notFound } from "next/navigation";
import { requireAdmin } from "@/lib/permissions";
import { isRhV2Enabled } from "@/lib/rh/flag";
import { PageHeader } from "@/components/ui/page-header";
import { PlanningTeamPanel } from "@/components/rh/PlanningTeamPanel";
import { currentIsoWeek } from "@/lib/rh/week";

export const metadata = { title: "Planning" };
export const dynamic = "force-dynamic";

/** Planning (RH V2) — présence/absences par semaine sur le socle neuf. Direction. */
export default async function RhPlanningPage() {
  if (!isRhV2Enabled()) notFound();
  const session = await auth();
  if (!session) redirect("/login");
  if (!(await requireAdmin(session))) redirect("/rh");
  return (
    <>
      <PageHeader kicker="RH · Direction" title="Planning" help="Qui travaille quand — présence badgée, congés approuvés et jours fériés, par semaine." />
      <PlanningTeamPanel initialWeek={currentIsoWeek()} />
    </>
  );
}
