import { auth } from "@/lib/auth";
import { redirect, notFound } from "next/navigation";
import { requireAdmin } from "@/lib/permissions";
import { isRhV2Enabled } from "@/lib/rh/flag";
import { PageHeader } from "@/components/ui/page-header";
import { EmployeeFiche } from "@/components/rh/EmployeeFiche";

export const metadata = { title: "Fiche salarié" };
export const dynamic = "force-dynamic";

/** Fiche salarié + journal (RH V2) — direction. Fin de contrat, historique. */
export default async function RhSalariePage(props: { params: Promise<{ id: string }> }) {
  if (!isRhV2Enabled()) notFound();
  const session = await auth();
  if (!session) redirect("/login");
  if (!(await requireAdmin(session))) redirect("/rh");
  const { id } = await props.params;
  return (
    <>
      <PageHeader kicker="RH · Direction" title="Fiche salarié" help="Contrats, fin de contrat, et registre complet des évènements RH." />
      <EmployeeFiche id={id} />
    </>
  );
}
