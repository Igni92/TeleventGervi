import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/permissions";
import { isPreparateur } from "@/lib/inventory";
import { isTerrainConfined } from "@/lib/preparateur";
import { InventairePanel } from "@/components/inventaire/InventairePanel";
import { PreparateurNav } from "@/components/PreparateurNav";
import { PageHeader } from "@/components/ui/page-header";

export const metadata = { title: "Inventaire" };
export const dynamic = "force-dynamic";

export default async function InventairePage() {
  const session = await auth();
  if (!session) redirect("/login");
  const admin = await requireAdmin(session);
  const prep = await isPreparateur(session.user?.email);

  return (
    <div className="space-y-6 sm:space-y-8 animate-fade-up">
      {isTerrainConfined(session) && <PreparateurNav current="inventaire" />}
      <PageHeader
        kicker="Préparation · stock physique"
        title="Inventaire"
        help={
          <>
            Comptage <b>pas à pas</b> : l&apos;app te propose les produits un par un. Compte le stock
            <b> réel</b>, ajoute des <b>photos de l&apos;entrepôt</b>, puis envoie — les écarts sont
            transmis aux administrateurs.
          </>
        }
      />
      <InventairePanel isAdmin={admin} isPreparateur={prep} />
    </div>
  );
}
