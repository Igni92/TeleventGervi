import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
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
export default async function DashboardPage() {
  const session = await auth();
  if (!session) redirect("/login");
  return <PilotageSlider />;
}
