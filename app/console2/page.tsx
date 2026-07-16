import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { MobileConsole2 } from "@/components/mobile/MobileConsole2";
import { PageHeader } from "@/components/ui/page-header";

export const metadata = { title: "Console 2 · Commande" };
export const dynamic = "force-dynamic";

/**
 * CONSOLE 2 MOBILE — l'onglet « bon de livraison » de la console d'appels en
 * version ALLÉGÉE (tags produit conservés), dans la coquille mobile standard
 * (AppLayout / MobileTopBar). Sur poste fixe, préférer /console/ecran2.
 */
export default async function Console2Page() {
  const session = await auth();
  if (!session) redirect("/login");

  return (
    <div className="space-y-4 animate-fade-up">
      <PageHeader
        kicker="Télévente"
        title="Console 2 — Commande"
        help={
          <>
            Saisie rapide d&apos;un <b>bon de livraison</b> depuis le stock — version allégée de
            l&apos;Écran 2 de la console, pensée pour mobile. Sur poste fixe, préfère la{" "}
            <b>Console d&apos;appels › Écran 2</b>.
          </>
        }
      />
      <MobileConsole2 />
    </div>
  );
}
