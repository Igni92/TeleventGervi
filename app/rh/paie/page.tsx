import { auth } from "@/lib/auth";
import { redirect, notFound } from "next/navigation";
import { requireAdmin } from "@/lib/permissions";
import { isRhV2Enabled } from "@/lib/rh/flag";
import { PageHeader } from "@/components/ui/page-header";
import { PaiePanel } from "@/components/rh/PaiePanel";

export const metadata = { title: "Paie & éléments de salaires" };
export const dynamic = "force-dynamic";

/** Paie / éléments de salaires (RH V2) — remplace l'ancien onglet Salaires. Direction. */
export default async function RhPaiePage() {
  if (!isRhV2Enabled()) notFound();
  const session = await auth();
  if (!session) redirect("/login");
  if (!(await requireAdmin(session))) redirect("/rh");
  const mois = new Date().toISOString().slice(0, 7);
  return (
    <>
      <PageHeader kicker="RH · Direction" title="Paie & éléments de salaires" help="Heures du mois (badgeuse) + éléments variables (primes, frais, 13e, récup payée…) à transmettre à la compta." />
      <PaiePanel initialMonth={mois} />
    </>
  );
}
