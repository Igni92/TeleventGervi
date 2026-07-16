import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { isAgreeur, requirePreparateurOrAdmin } from "@/lib/permissions";
import { isTerrainConfined } from "@/lib/preparateur";
import { PurchaseOrderHistory } from "@/components/entrees/PurchaseOrderHistory";
import { PurchaseOrderForm } from "@/components/entrees/PurchaseOrderForm";
import { PreparateurNav } from "@/components/PreparateurNav";
import { PageHeader } from "@/components/ui/page-header";

export const metadata = { title: "Cde Fournisseur" };
export const dynamic = "force-dynamic";

export default async function CommandesFournisseursPage() {
  const session = await auth();
  if (!session) redirect("/login");
  // L'AGRÉEUR « pur » (sans rôle de gestion) ne peut PAS créer de commande
  // fournisseur : on masque le formulaire de création. Il conserve l'historique
  // et l'action « Réceptionner → entrée marchandise » (son seul droit).
  const agreeurOnly = (await isAgreeur(session)) && !(await requirePreparateurOrAdmin(session));
  return (
    // Mobile : PLEIN ÉCRAN — gouttières de la coquille annulées, panneaux à
    // plat (`bleed`) : contenu bord à bord, pas une case sur un fond.
    <div className="space-y-6 sm:space-y-8 animate-fade-up max-sm:-mx-4 max-sm:-mt-2 max-sm:-mb-4 max-sm:space-y-3">
      {/* Nav terrain (mobile) : l'agréeur confiné navigue entre ses écrans. */}
      {isTerrainConfined(session) && <div className="max-sm:px-4"><PreparateurNav current="commandes-fournisseurs" /></div>}
      <PageHeader
        className="max-sm:hidden"
        kicker="SAP B1 · PurchaseOrder"
        title="Cde Fournisseur"
        help={
          <>
            Suivi des commandes d&apos;achat (engagements fournisseurs). Une commande arrivée
            à échéance de livraison est signalée <b>« à réceptionner »</b> ; sa validation crée
            l&apos;entrée marchandise correspondante et clôture la commande.
          </>
        }
      />
      {!agreeurOnly && <PurchaseOrderForm />}
      <PurchaseOrderHistory restricted={agreeurOnly} />
    </div>
  );
}
