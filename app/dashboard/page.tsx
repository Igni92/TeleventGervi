import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/permissions";
import { PilotageUnified } from "@/components/pilotage/PilotageUnified";

export const metadata = { title: "Dashboard — Cockpit" };
export const dynamic = "force-dynamic";

/**
 * /dashboard — PILOTAGE UNIFIÉ : les 3 anciens écrans (Commercial BL · Rapport
 * annuel · Carte géo) compressés en un seul cockpit compact, sans slider.
 * Survol = popover de détail ; clic = plein écran (modales clients/fournisseurs/
 * commerciaux-commissions, ou les écrans complets conservés en overlay).
 *
 * `/dashboard/ecran2` reste accessible comme page autonome pour le mode
 * dual-écran physique.
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
  return <PilotageUnified viewAs={viewAs} />;
}
