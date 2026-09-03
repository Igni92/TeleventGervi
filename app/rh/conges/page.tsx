import { auth } from "@/lib/auth";
import { redirect, notFound } from "next/navigation";
import { isRhV2Enabled } from "@/lib/rh/flag";
import { PageHeader } from "@/components/ui/page-header";
import { LeavesPanel } from "@/components/rh/LeavesPanel";

export const metadata = { title: "Congés" };
export const dynamic = "force-dynamic";

/** Congés & absences (RH V2) — self-service salarié + validation direction. */
export default async function RhCongesPage() {
  if (!isRhV2Enabled()) notFound();
  const session = await auth();
  if (!session) redirect("/login");
  return (
    <>
      <PageHeader kicker="RH" title="Congés & absences" help="Pose tes congés, suis leur validation. La direction valide les demandes en attente." />
      <LeavesPanel />
    </>
  );
}
