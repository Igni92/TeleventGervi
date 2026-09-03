import { auth } from "@/lib/auth";
import { redirect, notFound } from "next/navigation";
import { requireAdmin } from "@/lib/permissions";
import { isRhV2Enabled } from "@/lib/rh/flag";
import { PageHeader } from "@/components/ui/page-header";
import { DirectionCockpit } from "@/components/rh/DirectionCockpit";

export const metadata = { title: "Cockpit RH" };
export const dynamic = "force-dynamic";

/** Cockpit RH direction (RH V2) — réservé admin/direction, derrière le flag. */
export default async function RhDirectionPage() {
  if (!isRhV2Enabled()) notFound();
  const session = await auth();
  if (!session) redirect("/login");
  if (!(await requireAdmin(session))) redirect("/rh");
  return (
    <>
      <PageHeader kicker="RH · Direction" title="Cockpit RH" help="Présence en temps réel (badgeuse), effectif, échéances de contrat et congés à valider." />
      <DirectionCockpit />
    </>
  );
}
