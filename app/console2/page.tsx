import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { MobileConsole2 } from "@/components/mobile/MobileConsole2";

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
      <header>
        <p className="kicker mb-1.5">Télévente</p>
        <h1 className="font-display text-[28px] md:text-[34px] font-semibold text-foreground tracking-tight leading-none">
          Console 2 — Commande
        </h1>
        <p className="hidden md:block text-[12.5px] text-muted-foreground mt-2 max-w-2xl">
          Saisie rapide d&apos;un <b>bon de livraison</b> depuis le stock — version allégée de
          l&apos;Écran 2 de la console, pensée pour mobile. Sur poste fixe, préfère la{" "}
          <b>Console d&apos;appels › Écran 2</b>.
        </p>
      </header>
      <MobileConsole2 />
    </div>
  );
}
