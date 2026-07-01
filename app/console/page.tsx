import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { CallConsole } from "@/components/console/CallConsole";
import { ConsoleScreenGate } from "@/components/console/ConsoleScreenGate";
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

  // C3 — si le dernier écran Console consulté (dans cette fenêtre) est
  // l'Écran 2, le Gate redirige côté client vers /console/ecran2 sans flash.
  return (
    <ConsoleScreenGate>
      <CallConsole isAdmin={isAdmin} meInitials={meInitials} />
    </ConsoleScreenGate>
  );
}
