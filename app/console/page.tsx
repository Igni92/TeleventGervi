import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { CallConsole } from "@/components/console/CallConsole";
import { requireAdmin } from "@/lib/permissions";
import { initialsFromEmail } from "@/lib/salespeople";

export const metadata = { title: "Console" };
export const dynamic = "force-dynamic";

export default async function ConsolePage() {
  const session = await auth();
  if (!session) redirect("/login");

  // Actions portefeuille (inactiver / réassigner un client via clic droit) —
  // réservées aux admins ; on passe aussi le trigramme du commercial connecté
  // pour ne pas se proposer soi-même dans « Envoyer à ».
  const isAdmin = await requireAdmin(session);
  const meInitials = initialsFromEmail(session.user?.email) ?? null;

  // « Console d'appels » = toujours l'Écran 1 (file d'appel). La Console de
  // commande (Écran 2) a désormais sa propre entrée de navigation ; les deux
  // écrans restent synchronisés via consoleSync quand ils sont ouverts ensemble.
  return <CallConsole isAdmin={isAdmin} meInitials={meInitials} />;
}
