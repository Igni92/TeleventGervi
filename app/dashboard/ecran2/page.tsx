import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/permissions";
import { PilotageScreen2 } from "@/components/pilotage/PilotageScreen2";

export const metadata = { title: "Dashboard — Achat & Action" };
export const dynamic = "force-dynamic";

/**
 * /dashboard/ecran2 — Cockpit unifié, écran 2 (Achat & Action).
 *
 * Top fournisseurs (avec total entrées intégré), barres comparatives N vs N-1,
 * "À relancer" (clients planifiés sans facture SAP 30j, cliquable), clients actifs.
 * Granularité suit l'écran 1 (role=follower).
 */
export default async function DashboardEcran2Page({
  searchParams,
}: {
  searchParams: { as?: string };
}) {
  const session = await auth();
  if (!session) redirect("/login");
  // « Voir comme » : seul un admin peut imiter un commercial (?as=MM). Pour un
  // non-admin, le paramètre est ignoré (le backend le rejette de toute façon).
  const admin = await requireAdmin(session);
  const viewAs = admin && typeof searchParams.as === "string" && searchParams.as.trim()
    ? searchParams.as.trim()
    : null;
  return <PilotageScreen2 viewAs={viewAs} />;
}
