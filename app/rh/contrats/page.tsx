import { auth } from "@/lib/auth";
import { redirect, notFound } from "next/navigation";
import { requireAdmin } from "@/lib/permissions";
import { isRhV2Enabled } from "@/lib/rh/flag";
import { PageHeader } from "@/components/ui/page-header";
import { ContractsPanel } from "@/components/rh/ContractsPanel";

export const metadata = { title: "Contrats" };
export const dynamic = "force-dynamic";

/** Contrats & saisonniers (RH V2) — direction. Derrière le flag RH_V2. */
export default async function RhContratsPage() {
  if (!isRhV2Enabled()) notFound();
  const session = await auth();
  if (!session) redirect("/login");
  if (!(await requireAdmin(session))) redirect("/rh");
  return (
    <>
      <PageHeader kicker="RH · Direction" title="Contrats & saisonniers" help="Embauches, contrats (CDI/CDD/saisonnier), période d'essai. Les échéances alimentent les alertes du cockpit." />
      <ContractsPanel />
    </>
  );
}
