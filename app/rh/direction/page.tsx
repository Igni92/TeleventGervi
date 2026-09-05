import { auth } from "@/lib/auth";
import { redirect, notFound } from "next/navigation";
import { requireAdmin } from "@/lib/permissions";
import { isRhV2Enabled } from "@/lib/rh/flag";
import { PageHeader } from "@/components/ui/page-header";
import { RegistrePanel } from "@/components/rh/RegistrePanel";

export const metadata = { title: "Registre des salariés" };
export const dynamic = "force-dynamic";

/** Registre des salariés (RH V2) — liste unique : présence temps réel + contrats +
 *  configuration (embauche, renouvellement). Réservé admin/direction. */
export default async function RhDirectionPage() {
  if (!isRhV2Enabled()) notFound();
  const session = await auth();
  if (!session) redirect("/login");
  if (!(await requireAdmin(session))) redirect("/rh");
  return (
    <>
      <PageHeader kicker="RH · Direction" title="Registre des salariés" help="Liste unique : présence en temps réel, contrats, échéances et embauche — cliquez un salarié pour tout configurer." />
      <RegistrePanel />
    </>
  );
}
