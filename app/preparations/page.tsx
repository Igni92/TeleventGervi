import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { PreparationsAFaire } from "@/components/livraisons/PreparationsAFaire";
import { isTerrainConfined } from "@/lib/preparateur";
import { PreparateurNav } from "@/components/PreparateurNav";

export const metadata = { title: "Préparations à faire" };
export const dynamic = "force-dynamic";

export default async function PreparationsPage() {
  const session = await auth();
  if (!session) redirect("/login");

  return (
    <div className="space-y-6 animate-fade-up">
      {/* Nav terrain (mobile) pour les rôles confinés. */}
      {isTerrainConfined(session) && <PreparateurNav current="preparations" />}
      <header>
        <p className="kicker mb-1.5">Entrepôt · charge</p>
        <h1 className="font-display text-[28px] sm:text-[34px] font-semibold text-foreground tracking-tight leading-none">
          Préparations à faire
        </h1>
        <p className="hidden md:block text-[12.5px] text-muted-foreground mt-2 max-w-2xl">
          Toutes les commandes <b>pas encore préparées</b> des livraisons à venir, groupées par
          <b> date de livraison</b> (la plus proche en premier). Pour préparer une commande précise,
          passe par <b>Préparation livraisons</b>.
        </p>
      </header>
      <PreparationsAFaire />
    </div>
  );
}
