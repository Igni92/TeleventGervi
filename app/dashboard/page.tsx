import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/permissions";
import { PilotageSlider } from "@/components/pilotage/PilotageSlider";

export const metadata = { title: "Dashboard — Cockpit" };
export const dynamic = "force-dynamic";

/**
 * /dashboard — Slider plein écran qui réunit les deux cockpits sur la même URL :
 *   • Écran 1 (par défaut)  = Cockpit commercial (BL, volume, marge ligne par ligne).
 *   • Écran 2 (slide droite) = Rapport annuel comptable (Invoices, CA, marges).
 *
 * Navigation : scroll horizontal natif (snap), boutons chevron, flèches clavier ←/→,
 * dots indicateurs. `/dashboard/ecran2` reste accessible comme page autonome pour
 * le mode dual-écran physique.
 */
export default async function DashboardPage(
  props: {
    searchParams: Promise<{ as?: string }>;
  }
) {
  const searchParams = await props.searchParams;
  const session = await auth();
  if (!session) redirect("/login");
  // « Voir comme » : seul un admin peut imiter un commercial (?as=MM). Pour un
  // non-admin, le paramètre est ignoré (le backend le rejette de toute façon).
  const admin = await requireAdmin(session);
  const viewAs = admin && typeof searchParams.as === "string" && searchParams.as.trim()
    ? searchParams.as.trim()
    : null;
  return <PilotageSlider viewAs={viewAs} />;
}
