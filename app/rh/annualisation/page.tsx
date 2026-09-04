import { auth } from "@/lib/auth";
import { redirect, notFound } from "next/navigation";
import { requireAdmin } from "@/lib/permissions";
import { isRhV2Enabled } from "@/lib/rh/flag";
import { PageHeader } from "@/components/ui/page-header";
import { AnnualisationPanel } from "@/components/rh/AnnualisationPanel";

export const metadata = { title: "Annualisation 1600 h" };
export const dynamic = "force-dynamic";

/** Annualisation du temps de travail (IDCC 1405) — direction. */
export default async function RhAnnualisationPage() {
  if (!isRhV2Enabled()) notFound();
  const session = await auth();
  if (!session) redirect("/login");
  if (!(await requireAdmin(session))) redirect("/rh");
  return (
    <>
      <PageHeader kicker="RH · Direction" title="Annualisation 1600 h" help="Suivi de l'annualisation IDCC 1405 : dû théorique, réalisé, solde de modulation et contingent d'heures supp." />
      <AnnualisationPanel initialYear={new Date().getUTCFullYear()} />
    </>
  );
}
