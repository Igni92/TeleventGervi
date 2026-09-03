import { auth } from "@/lib/auth";
import { redirect, notFound } from "next/navigation";
import { isRhV2Enabled } from "@/lib/rh/flag";
import { PageHeader } from "@/components/ui/page-header";
import { BadgeStyles } from "@/components/rh/BadgeStyles";

export const metadata = { title: "Styles pointeuse" };
export const dynamic = "force-dynamic";

/** Comparateur temporaire des styles de bouton pointeuse — pour choisir en prod. */
export default async function RhStylesPage() {
  if (!isRhV2Enabled()) notFound();
  const session = await auth();
  if (!session) redirect("/login");
  return (
    <>
      <PageHeader kicker="RH · pointeuse" title="Choix du bouton" help="4 variantes côte à côte — le halo animé est plus visible sur fond sombre." />
      <BadgeStyles />
    </>
  );
}
