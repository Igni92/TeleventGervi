import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { CallConsole } from "@/components/console/CallConsole";
import { ConsoleScreenGate } from "@/components/console/ConsoleScreenGate";

export const metadata = { title: "Console" };
export const dynamic = "force-dynamic";

export default async function ConsolePage() {
  const session = await auth();
  if (!session) redirect("/login");

  // C3 — si le dernier écran Console consulté (dans cette fenêtre) est
  // l'Écran 2, le Gate redirige côté client vers /console/ecran2 sans flash.
  return (
    <ConsoleScreenGate>
      <CallConsole />
    </ConsoleScreenGate>
  );
}
