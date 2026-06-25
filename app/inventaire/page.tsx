import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/permissions";
import { InventairePanel } from "@/components/inventaire/InventairePanel";

export const metadata = { title: "Inventaire" };
export const dynamic = "force-dynamic";

export default async function InventairePage() {
  const session = await auth();
  if (!session) redirect("/login");
  const admin = await requireAdmin(session);

  return (
    <div className="space-y-6 sm:space-y-8 animate-fade-up">
      <div>
        <p className="kicker mb-2 hidden md:block">Préparation · stock physique</p>
        <h1 className="text-[26px] sm:text-[32px] font-bold text-foreground tracking-tight leading-none">
          Inventaire
        </h1>
        <p className="hidden md:block text-[13px] text-muted-foreground mt-3 max-w-2xl">
          Comptage <b>pas à pas</b> : l&apos;app te propose les produits un par un. Compte le stock
          <b> réel</b>, ajoute des <b>photos de l&apos;entrepôt</b>, puis envoie — les écarts sont
          transmis aux administrateurs.
        </p>
      </div>
      <InventairePanel isAdmin={admin} />
    </div>
  );
}
