import { auth } from "@/lib/auth";
import { redirect, notFound } from "next/navigation";
import { requireAdmin } from "@/lib/permissions";
import { isRhV2Enabled } from "@/lib/rh/flag";
import { PageHeader } from "@/components/ui/page-header";
import { AnalyticsPanel } from "@/components/rh/AnalyticsPanel";

export const metadata = { title: "Analytics RH" };
export const dynamic = "force-dynamic";

/** Turnover & analytics RH (RH V2) — direction. */
export default async function RhAnalyticsPage() {
  if (!isRhV2Enabled()) notFound();
  const session = await auth();
  if (!session) redirect("/login");
  if (!(await requireAdmin(session))) redirect("/rh");
  return (
    <>
      <PageHeader kicker="RH · Direction" title="Turnover & analytics" help="Effectif, entrées/sorties, turnover, ancienneté et absentéisme — sur 12 mois glissants." />
      <AnalyticsPanel />
    </>
  );
}
